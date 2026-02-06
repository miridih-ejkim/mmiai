import { MCPServer } from "@mastra/mcp";
import type { MCPClient } from "@mastra/mcp";
import { createDatahubFallbackTools } from "./datahub-fallback-tools";

/**
 * MCPClient에서 도구를 로드하여 MCPServer 인스턴스를 생성합니다.
 *
 * 각 서비스(Atlassian, DataHub, Google Search)별로 독립적인 MCPServer를 생성하여
 * Mastra에 등록하면, 필요에 따라 도구를 가져올 수 있습니다.
 *
 * DataHub의 search/get_lineage는 재귀 JSON Schema로 인해 자동 변환이 실패하므로
 * 수동 생성한 fallback 도구를 병합합니다.
 *
 * 개별 MCP 클라이언트 연결 실패 시 해당 서버만 스킵하고 나머지는 정상 등록됩니다.
 */
export async function createMcpServers(clients: {
  atlassian: MCPClient | null;
  datahub: MCPClient | null;
  googleSearch: MCPClient;
}) {
  const servers: Record<string, MCPServer> = {};
  const toolsByService: {
    atlassian: Record<string, any>;
    datahub: Record<string, any>;
    googleSearch: Record<string, any>;
  } = { atlassian: {}, datahub: {}, googleSearch: {} };
  const cleanups: Array<() => Promise<void>> = [];

  // === Atlassian ===
  if (clients.atlassian) {
    try {
      const tools = await clients.atlassian.listTools();
      toolsByService.atlassian = tools;
      servers.atlassianMcpServer = new MCPServer({
        id: "atlassian-mcp-server",
        name: "Atlassian MCP Server",
        version: "1.0.0",
        description:
          "Confluence/Jira 도구 제공 (문서 검색, 이슈 조회, 사용자 정보)",
        tools,
      });
    } catch (error) {
      console.warn("[atlassian] MCPServer 생성 실패, 스킵합니다:", error);
    }
  }

  // === DataHub ===
  if (clients.datahub) {
    try {
      // DataHub MCP의 JSON Schema는 재귀적 $defs, allOf 등을 포함하여
      // @mastra/mcp의 zod-from-json-schema 변환 시 ZodIntersection이 생성됨.
      // Claude는 ZodIntersection을 지원하지 않으므로, 모든 도구를 수동 정의합니다.
      let allTools: Record<string, any> = {};
      try {
        const fallback = await createDatahubFallbackTools();
        allTools = fallback.tools;
        cleanups.push(fallback.cleanup);
        if (Object.keys(allTools).length > 0) {
          console.log(
            `[datahub] Fallback 도구 ${Object.keys(allTools).length}개 로드 완료:`,
            Object.keys(allTools).join(", "),
          );
        }
      } catch (fallbackError) {
        console.warn("[datahub] Fallback 도구 생성 실패:", fallbackError);
      }
      toolsByService.datahub = allTools;
      servers.datahubMcpServer = new MCPServer({
        id: "datahub-mcp-server",
        name: "DataHub MCP Server",
        version: "1.0.0",
        description:
          "DataHub 데이터 카탈로그 도구 제공 (엔티티 검색, 리니지 분석, 스키마 조회)",
        tools: allTools,
      });
    } catch (error) {
      console.warn("[datahub] MCPServer 생성 실패, 스킵합니다:", error);
    }
  }

  // === Google Search ===
  try {
    const tools = await clients.googleSearch.listTools();
    toolsByService.googleSearch = tools;
    servers.googleSearchMcpServer = new MCPServer({
      id: "google-search-mcp-server",
      name: "Google Search MCP Server",
      version: "1.0.0",
      description: "Google 검색 및 웹페이지 콘텐츠 추출 도구 제공",
      tools,
    });
  } catch (error) {
    console.warn("[google-search] MCPServer 생성 실패, 스킵합니다:", error);
  }

  return {
    servers,
    toolsByService,
    cleanup: async () => {
      await Promise.allSettled(cleanups.map((fn) => fn()));
    },
  };
}
