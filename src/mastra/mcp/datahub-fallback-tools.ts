import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const MCP_DATAHUB_URL = process.env.MCP_DATAHUB_URL;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/**
 * DataHub MCP의 search/get_lineage 도구를 수동으로 생성합니다.
 *
 * 이 도구들의 JSON Schema는 재귀적 $defs (_And/_Or/_Not 상호 참조)를 포함하여
 * @mastra/mcp의 zod-from-json-schema 변환이 스택 오버플로를 일으킵니다.
 * 이를 우회하기 위해 MCP SDK Client로 직접 연결하여 도구를 수동 정의합니다.
 *
 * filters 파라미터는 z.any()로 정의하되, 도구 description에 필터 구조가 상세히
 * 기술되어 있어 LLM이 올바른 필터를 생성할 수 있습니다.
 */
export async function createDatahubFallbackTools(): Promise<{
  tools: Record<string, any>;
  cleanup: () => Promise<void>;
}> {
  // DataHub 연결 정보 확인
  if (!MCP_DATAHUB_URL && !process.env.DATAHUB_GMS_URL) {
    return { tools: {}, cleanup: async () => {} };
  }

  // Transport 생성 (하이브리드 아키텍처)
  let transport;
  if (MCP_DATAHUB_URL) {
    transport = new StreamableHTTPClientTransport(new URL(MCP_DATAHUB_URL), {
      requestInit: MCP_AUTH_TOKEN
        ? { headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` } }
        : undefined,
    });
  } else {
    transport = new StdioClientTransport({
      command: "uvx",
      args: ["mcp-server-datahub"],
      env: {
        ...process.env as Record<string, string>,
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL!,
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN || "",
      },
      stderr: "ignore",
    });
  }

  // MCP SDK Client 직접 연결
  const client = new Client(
    { name: "datahub-fallback", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // 원본 도구 정의에서 description 가져오기
  const { tools: rawTools } = await client.listTools();
  const searchDef = rawTools.find((t) => t.name === "search");
  const lineageDef = rawTools.find((t) => t.name === "get_lineage");

  const tools: Record<string, any> = {};

  if (searchDef) {
    tools.datahub_search = createTool({
      id: "datahub_search",
      description: searchDef.description || "Search DataHub entities",
      inputSchema: z.object({
        query: z.string().describe("Search query (use /q prefix for structured search)"),
        filters: z.any().optional().describe("Filter object (entity_type, platform, domain, tag, etc.)"),
        num_results: z.number().optional().describe("Number of results per page (max: 50)"),
        sort_by: z.string().optional().describe("Sort field (e.g. lastOperationTime)"),
        sort_order: z.string().optional().describe("Sort order: desc (default) or asc"),
        offset: z.number().optional().describe("Pagination offset (default: 0)"),
      }),
      execute: async (input) => {
        const result = await client.callTool({
          name: "search",
          arguments: input,
        });
        return extractMcpContent(result);
      },
    });
  }

  if (lineageDef) {
    tools.datahub_get_lineage = createTool({
      id: "datahub_get_lineage",
      description: lineageDef.description || "Get entity lineage",
      inputSchema: z.object({
        urn: z.string().describe("Entity URN (required)"),
        column: z
          .string()
          .nullable()
          .optional()
          .describe("Column name, null for entire entity"),
        query: z
          .string()
          .optional()
          .describe("Search within lineage results (use /q syntax)"),
        filters: z
          .any()
          .optional()
          .describe("Filter object (same as search tool)"),
        upstream: z
          .boolean()
          .optional()
          .describe("True for upstream, false for downstream"),
        max_hops: z
          .number()
          .optional()
          .describe("Max lineage hops (3 = unlimited)"),
        max_results: z.number().optional().describe("Max results to return"),
        offset: z.number().optional().describe("Pagination offset"),
      }),
      execute: async (input) => {
        const result = await client.callTool({
          name: "get_lineage",
          arguments: input,
        });
        return extractMcpContent(result);
      },
    });
  }

  // get_entities
  const getEntitiesDef = rawTools.find((t) => t.name === "get_entities");
  if (getEntitiesDef) {
    tools.datahub_get_entities = createTool({
      id: "datahub_get_entities",
      description: getEntitiesDef.description || "Get DataHub entities by URNs",
      inputSchema: z.object({
        urns: z.array(z.string()).describe("List of entity URNs to retrieve"),
      }),
      execute: async (input) => {
        const result = await client.callTool({
          name: "get_entities",
          arguments: input,
        });
        return extractMcpContent(result);
      },
    });
  }

  // get_dataset_queries
  const getDatasetQueriesDef = rawTools.find((t) => t.name === "get_dataset_queries");
  if (getDatasetQueriesDef) {
    tools.datahub_get_dataset_queries = createTool({
      id: "datahub_get_dataset_queries",
      description: getDatasetQueriesDef.description || "Get queries for a dataset",
      inputSchema: z.object({
        urn: z.string().describe("Dataset URN"),
      }),
      execute: async (input) => {
        const result = await client.callTool({
          name: "get_dataset_queries",
          arguments: input,
        });
        return extractMcpContent(result);
      },
    });
  }

  return {
    tools,
    cleanup: async () => {
      await client.close();
    },
  };
}

/**
 * MCP callTool 결과에서 텍스트 콘텐츠를 추출합니다.
 */
function extractMcpContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (result.isError) {
    throw new Error(
      Array.isArray(result.content)
        ? result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n")
        : "MCP tool execution failed",
    );
  }

  if (Array.isArray(result.content)) {
    return result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  return String(result.content);
}
