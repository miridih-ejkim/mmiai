import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
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
  instructions: `You are an intent classifier and execution planner. Analyze the user's message, classify it, and plan the execution strategy.

## Classification Rules

### "simple"
Greetings, small talk, simple questions not requiring any external data source.
Examples: 안녕하세요, 오늘 날씨 어때?, 나 우울해, 오늘 점심 메뉴 추천해줘

### "agent"
Any question that requires an external data source or tool. Route to one or more agents from the [AVAILABLE AGENTS] list provided in the user's message.
- Single agent needed: set targets to exactly one MCP ID
- Multiple agents needed: set targets to 2+ MCP IDs

## Output Rules
- type: "simple" or "agent"
- targets: list the MCP IDs from [AVAILABLE AGENTS] needed to answer the question
  - For "simple": empty array []
  - For "agent": 1 or more entries
  - ORDER MATTERS for sequential mode: list targets in execution order
- queries: provide a query for each target (Key: MCP ID)
  - For "simple": empty object {}
  - For "parallel" or single target: plain string query
  - For "sequential": object with { query, goal, contextHint }
    - query: the specific query for this agent
    - goal: what this step should accomplish (focus on what to produce for next steps)
    - contextHint: (2nd+ step only) what information to reference from the previous step's result. Omit for the first step.
- reasoning: brief explanation of why this classification was chosen
- executionMode: how targets are executed when there are 2+ targets
  - "parallel": targets are independent, can run simultaneously (default)
    Example: "Jira 이슈 찾고 관련 뉴스도 검색해줘" → independent queries
  - "sequential": targets have dependencies, must run in order (earlier results feed into later queries)
    Example: "Confluence에서 데이터 문서 찾고, 거기서 나온 테이블을 DataHub에서 조회해줘"
  - For single-target or simple: always "parallel" (ignored)

## Sequential Planning Examples

User: "Confluence에서 데이터 문서 찾고, 거기서 나온 테이블을 DataHub에서 조회해줘"
→ type: "agent", targets: ["atlassian", "datahub"], executionMode: "sequential"
→ queries: {
    "atlassian": { "query": "데이터 관련 문서 검색", "goal": "데이터 관련 문서를 찾고 언급된 테이블/데이터셋 이름 추출" },
    "datahub": { "query": "테이블 스키마 및 메타데이터 조회", "goal": "문서에서 참조된 테이블의 상세 정보 확인", "contextHint": "테이블 이름, 데이터셋 이름, URN" }
  }

User: "Jira에서 이번 스프린트 이슈 가져오고, 관련 내용을 웹에서 검색해줘"
→ type: "agent", targets: ["atlassian", "google-search"], executionMode: "sequential"
→ queries: {
    "atlassian": { "query": "현재 스프린트 이슈 목록 조회", "goal": "이번 스프린트의 주요 이슈와 키워드 추출" },
    "google-search": { "query": "스프린트 이슈 관련 기술 자료 검색", "goal": "이슈에서 언급된 기술 주제의 최신 정보 확인", "contextHint": "이슈 제목, 기술 키워드" }
  }

User: "Jira 이슈 찾고 관련 뉴스도 검색해줘" (independent)
→ type: "agent", targets: ["atlassian", "google-search"], executionMode: "parallel"
→ queries: { "atlassian": "Jira 이슈 검색", "google-search": "관련 뉴스 검색" }

User: "매출 테이블 분석해서 대시보드 만들어줘" (datahub → data-analyst chain)
→ type: "agent", targets: ["datahub", "data-analyst"], executionMode: "sequential"
→ queries: {
    "datahub": { "query": "매출 관련 테이블 검색 및 스키마 조회", "goal": "매출 테이블의 스키마, 컬럼, 데이터 타입 파악" },
    "data-analyst": { "query": "매출 데이터 분석 대시보드 생성", "goal": "DuckDB SQL로 매출 분석 대시보드 생성", "contextHint": "테이블명, 컬럼명, 데이터 타입, URN" }
  }

User: "users 테이블 스키마 보여줘" (simple metadata, datahub only)
→ type: "agent", targets: ["datahub"], executionMode: "parallel"
→ queries: { "datahub": "users 테이블 스키마 조회" }

IMPORTANT:
- When the user asks for data analysis, visualization, or dashboard creation, ALWAYS use sequential mode with datahub first then data-analyst.
- When the user asks for simple metadata lookup (schema, lineage, table info), use datahub alone.
- Only classify to agents listed in the [AVAILABLE AGENTS] section of the user's message.
- If no agents are available or the question doesn't match any, classify as "simple".
- For sequential mode, think carefully about what each step should produce and what the next step needs from it.`,
};

/**
 * 대화 Memory 옵션 — classifier와 finalResponser가 공유하는 Memory에 적용
 */
export const conversationMemoryOptions = {
  generateTitle: {
    model: "claude-haiku-4-5" as const,
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
- Role: [e.g., Developer, PM, Designer]
- Team:
- Primary Language: [e.g., Korean, English]

# Routing Preferences
- Frequently Used Agents: [e.g., atlassian, google-search, datahub]
- Default Jira Project: [e.g., PROJECT-KEY]
- Default Confluence Space: [e.g., SPACE-KEY]
- Frequently Queried Datasets: [e.g., table names]

# Conversation Context
- Recent Topics: [last 3-5 topics discussed]
- Pending Follow-ups: [unresolved questions or references]`,
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
