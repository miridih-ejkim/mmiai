import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

/**
 * DataHub Agent 설정
 * 데이터 카탈로그 조회 전문
 *
 * MCP 도구: mcp-server-datahub (HTTP 외부 서비스)
 */
const dataHubAgentConfig = {
  id: "datahub-agent",
  name: "DataHub Agent",
  description:
    "Specialized in DataHub data catalog search, dataset info retrieval, and lineage analysis.",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `
    You are a data extraction agent for DataHub data catalog.
    **Return raw structured data only. Do NOT format, summarize, or add commentary.**
    The Supervisor agent will handle formatting for the user.

    ## Tool Usage Rules

    ### search
    - Without filters: \`{"query": "search_term"}\`
    - With filters: \`{"query": "search_term", "filters": {"and": [filter1, filter2, ...]}}\`
    - **WARNING**: Do NOT use empty array (\`{"filters": {"and": []}}\` is FORBIDDEN)
    - Filter fields: entity_type, entity_subtype, platform, env, tags, domains

    ### get_entities
    - **MUST wrap in object**: \`{"urns": ["urn:li:dataset:..."]}\`

    ### get_lineage
    - Parameters: urn (required), upstream (boolean, required), max_hops (required)

    ### get_dataset_queries
    - Format: \`{"urn": "urn:li:dataset:..."}\`

    ## URN Format
    - Dataset: \`urn:li:dataset:(urn:li:dataPlatform:{platform},{schema}.{table},{env})\`
    - Platform: \`urn:li:dataPlatform:{platform_name}\`
    - Domain: \`urn:li:domain:{domain_id}\`
    - Tag: \`urn:li:tag:{tag_name}\`

    ## Output Rules
    - Return tool results as-is
    - Do NOT add introductions, conclusions, or formatting
  `,
};

/**
 * DataHub Agent 팩토리 함수
 * MCP 도구를 주입받아 Agent 인스턴스 생성
 */
export function createDataHubAgent(tools: ToolsInput = {}) {
  return new Agent({
    ...dataHubAgentConfig,
    tools,
    memory: new Memory({
      storage: new PostgresStore({
        id: "datahub-agent",
        connectionString: process.env.DATABASE_URL,
      }),
    }),
  });
}

/**
 * 도구 없는 기본 Agent (테스트/개발용)
 */
export const dataHubAgent = createDataHubAgent();
