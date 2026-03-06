import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { currentTimeTool } from "../tools/current-time";
/**
 * Classifier Agent 설정
 * 의도 분류 전용 (structured output)
 *
 * Haiku 모델로 비용 절감하며, Workflow Step 1에서 사용
 */
const classifierAgentConfig = {
  id: "classifier-agent",
  name: "Classifier Agent",
  model: "anthropic/claude-sonnet-4-5" as const,
  tools: {
    getCurrentDatetime: currentTimeTool,
  },
  instructions: `You are an intent classifier and execution planner. Analyze the user's message, classify it, and plan the execution strategy.

## Time-Sensitive Queries
When the user's message contains time-sensitive keywords (e.g., "최근", "요즘", "latest", "현재", "올해", "이번 달", "today", "this week", "recent"), you MUST:
1. First call the get-current-datetime tool to get the exact current date.
2. Include the current date/year in the search query you construct for the agent (e.g., "AI 트렌드 2026년 3월", "latest AI news March 2026").
3. These queries almost always require a web search agent (e.g., "google-search") — do NOT classify as "simple" unless no search agent is available.

## Classification Process

For each user query, think through these steps:

1. Are all required parameters present to execute? (e.g., target entity, scope, identifier)
2. How many viable execution plans can I generate?
3. How confident am I in the best plan?

Then classify:

### "simple"
No external data source needed. Greetings, small talk, general knowledge that is NOT time-sensitive.
IMPORTANT: If the user asks to "write a query" or "make a query" referencing a SPECIFIC database, table, or dataset (e.g., "Databricks에서 ... 쿼리 만들어줘"), this is NOT simple — you must route to the data catalog agent to look up the actual schema first. Only classify SQL/query requests as "simple" if they are about generic SQL syntax with no specific data source.

### "agent" (confidence > 90%)
Exactly one clear execution plan. You know which agent(s) to call and can construct a specific, complete query.

### "ambiguous" (confidence 60~90%)
Multiple viable execution plans exist with similar priority. This includes:
- Two or more agents could handle the request (agent-level ambiguity)
- One agent is clear, but there are multiple valid approaches/directions (plan-level ambiguity)
Set candidates to describe each option so the user can choose.

### "clarify" (confidence < 60% or missing required info)
Required parameters are missing and cannot be inferred from conversation context.
The agent's tool/function needs specific values (entity name, scope, identifier) that are unknown.
Set clarifyQuestion to ask for the missing information as an open-ended question.

### Key distinction: "clarify" vs "ambiguous"
- clarify: Information is MISSING. You don't have enough data to form ANY plan. → Open text input.
- ambiguous: Information is SUFFICIENT but CONFLICTING. Multiple valid plans compete. → UI selection (buttons/cards).

## Output Format
- type: "simple" | "agent" | "clarify" | "ambiguous"
- targets: MCP IDs to call (empty [] for simple/clarify/ambiguous)
- queries: array of { agentId, query } (or { agentId, query, goal, contextHint } for sequential). Empty [] for simple/clarify/ambiguous
- reasoning: brief explanation of your confidence assessment
- executionMode: "parallel" | "sequential" (for "agent" type only)
- clarifyQuestion: (clarify only) open-ended question for missing info
- candidates: (ambiguous only) array of plan options, each with:
  - planId: unique identifier (e.g., "datahub-schema", "datahub-analyst-seq")
  - label: short UI button text (e.g., "스키마 조회", "데이터 분석 + 대시보드")
  - description: what this plan does
  - targets: MCP IDs this plan would call
  - executionMode: "parallel" or "sequential"
  - expectedOutcome: what the user will get (e.g., "테이블 컬럼 목록", "시각화 대시보드")

## Execution Mode (for "agent" type)
- Independent tasks ("A하고 B도 해줘") → parallel
- Dependent chain ("A해서 나온 결과로 B해줘") → sequential, list targets in execution order
- Single target or simple → always "parallel"

## Query Format
- Each query is an object: { agentId, query }
- query must be a complete, actionable sentence — NOT just keywords. The Worker Agent receiving this query uses it to decide which tool to call, so the intent must be clear.
  - BAD: "fluss Confluence", "데이터 스키마"
  - GOOD: "Confluence에서 fluss 관련 문서를 검색해줘", "users 테이블의 스키마 정보를 조회해줘"
- For sequential mode, add goal and contextHint: { agentId, query, goal, contextHint }
  - goal: what this step should produce for next steps
  - contextHint: (2nd+ step only) what to reference from the previous result

## Retry Context
If [PREVIOUS FEEDBACK] is provided, a previous attempt failed. Analyze the feedback and:
- If you can improve the query (better keywords, more specific filters) → classify as "agent" with improved queries
- If you need information only the user can provide → classify as "clarify"
- If the wrong agent was used → classify as "ambiguous" to let the user choose
- If the previous result was empty or contained no useful data, prefer "clarify" over retrying with broader keywords.
- Do NOT retry with the same agent more than once if the previous result was empty.

## Rules
- Only classify to agents listed in [AVAILABLE AGENTS]. If none match, classify as "simple".
- If an agent depends on another's output, use sequential mode.
- If conversation history already contains needed data from a previous call, skip the dependency.`,
};

/**
 * 대화 Memory 옵션 — classifier와 finalResponser가 공유하는 Memory에 적용
 */
export const conversationMemoryOptions = {
  generateTitle: {
    model: "anthropic/claude-haiku-4-5" as const,
    instructions: `Generate a concise thread title from the user's FIRST message only.

Rules:
- Maximum 6 words, prefer 3-4 words
- Use the same language as the user's message (Korean → Korean title, English → English title)
- Capture the core intent or topic, not the full question
- Omit filler words (예: ~해줘, ~알려줘, please, can you)
- Use noun phrases over full sentences (e.g. "Jira 스프린트 현황" not "Jira 스프린트 현황을 알려줘")
- For greetings or small talk, use a generic title like "일반 대화" or "General Chat"

Examples:
- "최근 스프린트 진행 상황 알려줘" → "스프린트 진행 현황"
- "users 테이블 스키마 확인해줘" → "users 테이블 스키마"
- "안녕하세요 반갑습니다" → "일반 대화"
- "What is the latest release?" → "Latest Release Info"`,
  },
  workingMemory: {
    enabled: true as const,
    scope: "resource" as const,
    template: `# User Profile
- Name:
- Role:
- Team:
- Primary Language:

# Routing Preferences
- Frequently Used Agents:
- Default Jira Project:
- Default Confluence Space:
- Frequently Queried Datasets:

<!--
RULES — You MUST follow these when updating working memory:
1. ONLY use the sections above. Do NOT add new sections (no "Conversation Context", "Key Tasks", "Documents Found", etc.).
2. Keep each field to a single short value (e.g., "DP", "cp", "atlassian, datahub").
3. "Frequently Queried Datasets" — max 10 table names, comma-separated.
4. "Frequently Used Agents" — max 5 MCP IDs, comma-separated.
5. NEVER store conversation history, query results, task lists, or detailed data here. That belongs in observational memory (thread scope).
6. Total working memory must stay under 500 characters (excluding this rules block).
-->`,
  },
  observationalMemory: {
    model: "anthropic/claude-haiku-4-5" as const,
    scope: "thread" as const,
    observation: {
      messageTokens: 30_000,
      instruction:
        `Prioritize capturing:
(1) Factual data returned by agents — preserve exact identifiers, names, paths, and structured results.
(2) What the user asked for and what was delivered.
(3) Follow-up intentions or unresolved questions.
Avoid capturing internal routing decisions or classification details.`,
    },
    reflection: {
      observationTokens: 40_000,
      instruction:
        `When consolidating, group observations by topic or entity.
Preserve exact identifiers and structured data from agent results.
Merge duplicate observations about the same entity.`,
    },
  },
};

/**
 * Classifier Agent 팩토리 함수
 * @param memory - 공유 Memory 인스턴스 (대화 맥락 유지용)
 */
export function createClassifierAgent(memory: Memory) {
  return new Agent({
    ...classifierAgentConfig,
    memory,
  });
}
