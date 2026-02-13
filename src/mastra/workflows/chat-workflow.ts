import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { classifyIntentStep } from "./steps/classify-intent";
import { directResponseStep, agentStep } from "./steps/agent-steps";
import { synthesizeResponseStep } from "./steps/synthesize-response";
import { qualityCheckStep } from "./steps/quality-check";

/**
 * Chat Workflow
 *
 * Lazy MCP Loading + Deterministic Workflow + HITL 구조:
 *
 * Step 1 (classify-intent):
 *   Classifier Agent (Haiku)가 의도를 분류하여 structured output 반환
 *   활성 MCP만 대상으로 분류 (RequestContext의 activeMcpIds 참조)
 *   type: "simple" | "agent", targets: MCP ID[], executionMode: parallel|sequential
 *
 * .branch() (결정적 분기 — 2개):
 *   - simple → directResponseStep (Agent 호출 없음)
 *   - agent  → agentStep (targets 기반 동적 호출, lazy toolsets 주입)
 *     - targets 1개: single agent 호출
 *     - targets 2개+: parallel/sequential 호출
 *
 * .map() (출력 정규화):
 *   .branch() 출력에서 실행된 분기의 결과만 추출
 *
 * Quality Check (quality-check):
 *   규칙 기반 품질 평가 → 통과 시 다음 Step, 실패 시 suspend (HITL)
 *   Resume 시 사용자 피드백으로 Agent 재실행 (lazy toolsets 주입)
 *
 * Final Step (synthesize-response):
 *   Final Responser Agent (Haiku)가 결과를 사용자 친화적 응답으로 합성
 */
export const chatWorkflow = createWorkflow({
  id: "chat-workflow",
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
})
  .then(classifyIntentStep)
  .branch([
    [
      async ({ inputData }) => inputData.type === "simple",
      directResponseStep,
    ],
    [
      async ({ inputData }) => inputData.type === "agent",
      agentStep,
    ],
  ])
  .map(async ({ inputData }) => {
    // .branch() 출력: 실행된 분기의 step-id를 키로 결과 반환
    const result =
      inputData["direct-response"] ||
      inputData["agent-step"];

    return result || { source: "unknown", content: "", success: false };
  })
  .then(qualityCheckStep)
  .then(synthesizeResponseStep)
  .commit();
