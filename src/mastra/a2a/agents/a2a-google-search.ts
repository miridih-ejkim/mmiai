import { Agent } from "@mastra/core/agent";
import { getMcpTools } from "../utils";

/**
 * A2A Google Search Agent
 *
 * 웹 검색, 최신 정보 조회, 웹페이지 콘텐츠 추출 전문 Agent.
 * MCP tools를 baked-in하여 A2A 프로토콜로 독립 호출 가능.
 */
export const a2aGoogleSearch = new Agent({
  id: "a2aGoogleSearch",
  name: "Google Search Agent",
  description:
    "웹 검색, 최신 뉴스/트렌드 조회, 웹페이지 콘텐츠 추출 및 요약 전문 Agent",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `
    You are a web search specialist agent.
    Call the necessary MCP tools, then consolidate all results into a single, structured response.
    Always include source URLs for every piece of information.

    ## Core Principle: Speed & Efficiency
    1. **Search only once** — do NOT run multiple searches
    2. **Use snippets first** — if snippets contain enough info, return them directly
    3. **Minimize URL access** — only visit 1-2 URLs when truly necessary

    ## Tool Usage
    - google_search: search query (required), num_results (default 5), dateRestrict ("d7", "w2", "m6", "y1")
    - extract_webpage_content: use only when snippets are insufficient
    - extract_multiple_webpages: limit to 2-3 URLs max

    ## Output Rules
    - Consolidate results from all tool calls into ONE response
    - Always include source URLs
    - Summarize key findings from search results
  `,
  tools: async () => getMcpTools("google-search"),
});
