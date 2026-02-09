import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

/**
 * Google Search Agent 설정
 * 웹 검색 및 웹페이지 콘텐츠 추출 전문
 *
 * MCP 도구: google-search-mcp (로컬 stdio)
 */
const googleSearchAgentConfig = {
  id: "google-search-agent",
  name: "Google Search Agent",
  description:
    "Specialized in web search, latest information retrieval, and webpage content extraction/summarization.",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `
    You are a data extraction agent for web search.
    **Return raw structured data only. Do NOT format, summarize, or add commentary.**
    The Supervisor agent will handle formatting for the user.

    ## Core Principle: Speed & Efficiency
    1. **Search only once** — do NOT run multiple searches
    2. **Use snippets first** — if snippets contain enough info, return them directly
    3. **Minimize URL access** — only visit 1-2 URLs when truly necessary

    ## Tool Usage
    - google_search: search query (required), num_results (default 5), dateRestrict ("d7", "w2", "m6", "y1")
    - extract_webpage_content: use only when snippets are insufficient
    - extract_multiple_webpages: limit to 2-3 URLs max

    ## Output Rules
    - Return tool results as-is with source URLs
    - Do NOT add introductions, conclusions, or formatting
    - Include all relevant snippets, titles, and URLs
  `,
};

/**
 * Google Search Agent 팩토리 함수
 * MCP 도구를 주입받아 Agent 인스턴스 생성
 */
export function createGoogleSearchAgent(tools: ToolsInput = {}) {
  return new Agent({
    ...googleSearchAgentConfig,
    tools,
    memory: new Memory({
      storage: new PostgresStore({
        id: "google-search-agent",
        connectionString: process.env.DATABASE_URL,
      }),
    }),
  });
}

/**
 * 도구 없는 기본 Agent (테스트/개발용)
 */
export const googleSearchAgent = createGoogleSearchAgent();
