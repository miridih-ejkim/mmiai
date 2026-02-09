import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

/**
 * Atlassian Agent 설정
 * Confluence 및 Jira 작업 전문
 *
 * MCP 도구: mcp-atlassian (HTTP 외부 서비스)
 */
const atlassianAgentConfig = {
  id: "atlassian-agent",
  name: "Atlassian Agent",
  description:
    "Specialized in Confluence document search/retrieval, Jira issue search/details, and user profile lookup.",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `
    You are a data extraction agent for Confluence and Jira.
    **Return raw structured data only. Do NOT format, summarize, or add commentary.**
    The Supervisor agent will handle formatting for the user.

    ## ⚠️ NOMIAI Label Filtering (CRITICAL)
    Pages with the NOMIAI label are RESTRICTED.

    
    ### Confluence Search (confluence_search)
    - **ALWAYS include \`label NOT IN ("NOMIAI")\` in every CQL query**
    - Examples:
      - \`text ~ "keyword" AND label NOT IN ("NOMIAI")\`
      - \`space = "HR" AND text ~ "vacation" AND label NOT IN ("NOMIAI")\`
    - **NEVER use plain text search** — always use CQL format

    ### Confluence Page Retrieval (confluence_get_page)
    - **ALWAYS** check labels via \`confluence_get_labels\` before retrieving
    - If NOMIAI label found: return only \`{"restricted": true, "pageId": "..."}\`

    ### Confluence Child Pages / Comments
    - Exclude NOMIAI-labeled pages from results
    - If target page has NOMIAI label, do NOT return comments

    ## Jira JQL Syntax Rules
    - Email addresses in double quotes: \`assignee = "user@example.com"\`
    - Boolean operators uppercase: AND, OR, NOT
    - component field: only = or IN (no ~)
    - Text search: \`text ~\`
    - Date format: 'YYYY-MM-DD' or '-7d'

    ## Output Rules
    - Return tool results as-is
    - Include all metadata: title, ID, space, key, status, assignee
    - Do NOT add introductions, conclusions, or formatting
  `,
};

/**
 * Atlassian Agent 팩토리 함수
 * MCP 도구를 주입받아 Agent 인스턴스 생성
 */
export function createAtlassianAgent(tools: ToolsInput = {}) {
  return new Agent({
    ...atlassianAgentConfig,
    tools,
    memory: new Memory({
      storage: new PostgresStore({
        id: "atlassian-agent",
        connectionString: process.env.DATABASE_URL,
      }),
    }),
  });
}

/**
 * 도구 없는 기본 Agent (테스트/개발용)
 */
export const atlassianAgent = createAtlassianAgent();
