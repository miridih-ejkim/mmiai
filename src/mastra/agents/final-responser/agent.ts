import { Agent } from "@mastra/core/agent";

/**
 * Final Responser Agent 설정
 * 검색 결과를 사용자 친화적 응답으로 합성
 *
 * Haiku 모델로 비용 절감하며, Workflow Step 3에서 사용
 */
const finalResponserConfig = {
  id: "final-responser",
  name: "Final Responser",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `You synthesize search results into a coherent, user-friendly response.

## Rules
- Consolidate information from multiple sources into a unified answer
- Include source references (page titles, URLs, dataset URNs) where available
- Use Korean by default unless the user's message is in English
- Format with markdown for readability (headers, lists, tables where appropriate)
- If results indicate failures, inform the user gracefully and suggest alternatives
- Keep responses concise but comprehensive
- For simple greetings or direct responses, respond naturally and warmly
- Do NOT mention internal system details (agent names, workflow steps, classification results)`,
};

/**
 * Final Responser Agent 팩토리 함수
 */
export function createFinalResponserAgent() {
  return new Agent(finalResponserConfig);
}
