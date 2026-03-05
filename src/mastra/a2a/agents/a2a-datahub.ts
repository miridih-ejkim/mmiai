import { Agent } from "@mastra/core/agent";
import { getMcpTools } from "../utils";

/**
 * A2A DataHub Agent
 *
 * 데이터 카탈로그 검색, 데이터셋 정보 조회, 리니지 분석 전문 Agent.
 * MCP tools를 baked-in하여 A2A 프로토콜로 독립 호출 가능.
 */
export const a2aDataHub = new Agent({
  id: "a2aDataHub",
  name: "A2A DataHub Agent",
  description:
    "데이터 카탈로그 검색, 데이터셋/테이블 스키마 조회, 데이터 리니지 분석 전문 Agent",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `
    You are a DataHub data catalog specialist agent.
    Call the necessary MCP tools, then consolidate all results into a single, structured response.
    Always include dataset URNs and platform info for reference.

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
    - Consolidate results from all tool calls into ONE response
    - Use tables for schema/column info when appropriate
    - Include URNs and platform details for reference
  `,
  tools: async () => getMcpTools("datahub"),
});
