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
Greetings, small talk, or questions not requiring any external data source.

### "agent"
Any question requiring an external data source or tool. Route to agents from [AVAILABLE AGENTS].

## Output Format
- type: "simple" or "agent"
- targets: MCP IDs to call (empty [] for simple)
- queries: query per target
  - parallel/single: plain string
  - sequential: { query, goal, contextHint }
    - goal: what this step should produce for next steps
    - contextHint: (2nd+ step only) what to reference from the previous result
- reasoning: brief explanation
- executionMode: "parallel" (independent) or "sequential" (dependent, order matters)

## Execution Mode
Infer from the user's intent:
- Independent tasks ("A하고 B도 해줘") → parallel
- Dependent chain ("A해서 나온 결과로 B해줘") → sequential, list targets in execution order
- Single target or simple → always "parallel"

## Format Examples

Sequential (dependent chain):
→ targets: ["agent-a", "agent-b"], executionMode: "sequential"
→ queries: {
    "agent-a": { "query": "...", "goal": "extract X for next step" },
    "agent-b": { "query": "...", "goal": "use X to produce Y", "contextHint": "X names, IDs" }
  }

Parallel (independent):
→ targets: ["agent-a", "agent-b"], executionMode: "parallel"
→ queries: { "agent-a": "query A", "agent-b": "query B" }

## Rules
- Only classify to agents listed in [AVAILABLE AGENTS]. If none match, classify as "simple".
- If an agent depends on another's output (e.g., needs metadata before analysis), use sequential mode.
- If conversation history already contains the needed data from a previous agent call, you may skip the dependency and call the downstream agent directly.`,
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
- Frequently Queried Datasets: [e.g., table names]`,
  },
  observationalMemory: {
    model: "google/gemini-2.5-flash" as const,
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
