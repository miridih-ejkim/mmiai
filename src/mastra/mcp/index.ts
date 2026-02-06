import {
  atlassianMcpClient,
  datahubMcpClient,
  googleSearchMcpClient,
  disconnectMcp as disconnectMcpClients,
} from "./client";
import { createMcpServers } from "./server";

/**
 * MCP 오케스트레이션
 *
 * 1. MCPClient로 외부 MCP 서버에 연결하여 도구를 로드
 * 2. MCPServer 인스턴스로 래핑하여 Mastra에 등록 가능하게 export
 *
 * top-level await로 서버 시작 시 즉시 초기화됩니다.
 */
const { servers: mcpServers, toolsByService: mcpToolsByService, cleanup: cleanupFallback } =
  await createMcpServers({
    atlassian: atlassianMcpClient,
    datahub: datahubMcpClient,
    googleSearch: googleSearchMcpClient,
  });

export { mcpServers, mcpToolsByService };

/**
 * 모든 MCP 연결 해제 (MCPClient + fallback SDK Client)
 */
export async function disconnectMcp() {
  await Promise.allSettled([disconnectMcpClients(), cleanupFallback()]);
}
