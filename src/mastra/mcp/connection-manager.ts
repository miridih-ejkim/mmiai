import { MCPClient } from "@mastra/mcp";
import { getRegistryEntry } from "./mcp-registry";
import { createDatahubFallbackTools } from "./datahub-fallback-tools";

/**
 * Lazy MCP Connection Manager
 *
 * MCPClient 인스턴스를 요청 시점에 lazy하게 생성/캐시합니다.
 * - 사용자별이 아닌 전역 캐시 (같은 MCP 서버 URL/프로세스 공유)
 * - idle TTL 이후 자동 disconnect
 * - DataHub fallback 도구 특수 처리 지원
 *
 * 사용 방법:
 * ```
 * const toolsets = await mcpConnectionManager.getToolsets("atlassian");
 * const result = await agent.generate(query, { toolsets });
 * ```
 */

interface CachedConnection {
  client: MCPClient;
  lastUsed: number;
  /** DataHub fallback SDK Client cleanup 함수 */
  fallbackCleanup?: () => Promise<void>;
}

/** DataHub fallback 도구 캐시 */
interface FallbackToolsCache {
  toolsets: Record<string, any>;
  cleanup: () => Promise<void>;
  lastUsed: number;
}

export class McpConnectionManager {
  private connections = new Map<string, CachedConnection>();
  private fallbackCache: FallbackToolsCache | null = null;
  private idleTtlMs = 5 * 60 * 1000; // 5분
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 1분마다 idle 연결 정리
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60 * 1000);
  }

  /**
   * 특정 MCP 서버의 toolsets를 반환합니다.
   * 연결이 없으면 lazy하게 생성합니다.
   */
  async getToolsets(mcpId: string): Promise<Record<string, any>> {
    const entry = getRegistryEntry(mcpId);
    if (!entry) {
      console.warn(`[McpConnectionManager] Unknown MCP ID: ${mcpId}`);
      return {};
    }

    // DataHub fallback 경로
    if (entry.requiresFallback) {
      return this.getFallbackToolsets(mcpId);
    }

    // 일반 MCPClient 경로
    const cached = this.connections.get(mcpId);
    if (cached) {
      cached.lastUsed = Date.now();
      try {
        return await cached.client.listToolsets();
      } catch (error) {
        // 연결 끊김 → 재연결
        console.warn(
          `[McpConnectionManager] ${mcpId} connection stale, reconnecting...`,
        );
        await this.disconnectOne(mcpId);
      }
    }

    // 새 연결 생성
    return this.connect(mcpId, entry);
  }

  /**
   * idle TTL이 지난 연결을 정리합니다.
   */
  async cleanupIdle(): Promise<void> {
    const now = Date.now();

    for (const [id, conn] of this.connections) {
      if (now - conn.lastUsed > this.idleTtlMs) {
        console.log(
          `[McpConnectionManager] Disconnecting idle MCP: ${id}`,
        );
        await this.disconnectOne(id);
      }
    }

    // Fallback 캐시도 정리
    if (this.fallbackCache && now - this.fallbackCache.lastUsed > this.idleTtlMs) {
      console.log(`[McpConnectionManager] Disconnecting idle DataHub fallback`);
      await this.fallbackCache.cleanup();
      this.fallbackCache = null;
    }
  }

  /**
   * 모든 연결을 해제합니다 (서버 종료 시).
   */
  async disconnectAll(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const disconnects = Array.from(this.connections.keys()).map((id) =>
      this.disconnectOne(id),
    );

    if (this.fallbackCache) {
      disconnects.push(this.fallbackCache.cleanup());
      this.fallbackCache = null;
    }

    await Promise.allSettled(disconnects);
  }

  private async connect(
    mcpId: string,
    entry: { buildServerDef: () => any },
  ): Promise<Record<string, any>> {
    const serverDef = entry.buildServerDef();
    if (!serverDef) {
      console.warn(
        `[McpConnectionManager] ${mcpId} server not configured (env missing)`,
      );
      return {};
    }

    try {
      const client = new MCPClient({
        id: `${mcpId}-mcp-lazy`,
        servers: { [mcpId]: serverDef },
        timeout: 60000,
      });

      const toolsets = await client.listToolsets();

      this.connections.set(mcpId, {
        client,
        lastUsed: Date.now(),
      });

      console.log(
        `[McpConnectionManager] Connected to ${mcpId} (${Object.keys(toolsets).length} tools)`,
      );
      return toolsets;
    } catch (error) {
      console.error(
        `[McpConnectionManager] Failed to connect to ${mcpId}:`,
        error,
      );
      return {};
    }
  }

  /**
   * DataHub fallback 도구 (재귀 JSON Schema 문제 우회)
   *
   * MCPClient 대신 MCP SDK Client로 직접 연결하여 수동 정의된 도구를 반환합니다.
   * listToolsets() 형식과 호환되도록 toolsets 형태로 래핑합니다.
   */
  private async getFallbackToolsets(
    mcpId: string,
  ): Promise<Record<string, any>> {
    if (this.fallbackCache) {
      this.fallbackCache.lastUsed = Date.now();
      return this.fallbackCache.toolsets;
    }

    try {
      const { tools, cleanup } = await createDatahubFallbackTools();

      // createTool로 만든 도구를 toolsets 형식으로 변환
      // listToolsets()는 { "serverName.toolName": tool } 형식을 반환하지만
      // fallback 도구는 이미 { "datahub_search": tool } 형식이므로 그대로 사용
      this.fallbackCache = {
        toolsets: tools,
        cleanup,
        lastUsed: Date.now(),
      };

      console.log(
        `[McpConnectionManager] DataHub fallback tools loaded (${Object.keys(tools).length} tools)`,
      );
      return tools;
    } catch (error) {
      console.error(
        `[McpConnectionManager] Failed to load DataHub fallback tools:`,
        error,
      );
      return {};
    }
  }

  private async disconnectOne(mcpId: string): Promise<void> {
    const conn = this.connections.get(mcpId);
    if (conn) {
      try {
        await conn.client.disconnect();
      } catch {
        // 무시
      }
      this.connections.delete(mcpId);
    }
  }
}

export const mcpConnectionManager = new McpConnectionManager();
