import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { classifyIntentStep } from "./steps/classify-intent";
import { directResponseStep, agentStep } from "./steps/agent-steps";
import { synthesizeResponseStep } from "./steps/synthesize-response";
import { qualityCheckStep } from "./steps/quality-check";
import { workflowStateSchema } from "./state";

/**
 * dountil 루프 IO 스키마
 *
 * 1차 iteration: chatWorkflow가 { message } 전달
 * 2차+ iteration: quality-check의 output { source, content, success } 전달
 *
 * message는 1차에만 존재하며, 2차+에서는 getInitData()로 원본 메시지 접근.
 * 두 형태를 모두 허용하기 위해 전체 필드를 optional로 설정.
 */
const loopIOSchema = z.object({
  message: z.string().optional(),
  source: z.string().optional(),
  content: z.string().optional(),
  success: z.boolean().optional(),
});

/**
 * 내부 루프 Workflow: 분류 → 실행 → 품질 평가
 *
 * dountil 루프의 본체로 사용됩니다.
 * - classify-intent: 의도 분류 (clarify/ambiguous 시 suspend)
 * - branch: simple → directResponse, agent → agentStep
 * - quality-check: 품질 게이트 (실패 시 source="retry" 반환)
 *
 * quality-check가 "retry"를 반환하면 dountil이 이 workflow를 다시 실행합니다.
 * classify-intent가 state.previousFeedback을 참조하여 개선된 전략을 수립합니다.
 */
const classifyAndExecuteWorkflow = createWorkflow({
  id: "classify-and-execute",
  inputSchema: loopIOSchema,
  outputSchema: loopIOSchema,
  stateSchema: workflowStateSchema,
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
  .commit();

/** 최대 루프 횟수 (무한 루프 방지) */
const MAX_LOOP_ITERATIONS = 3;

/**
 * Chat Workflow
 *
 * Classifier 중심 단일 Suspend 포인트 + dountil 루프 구조:
 *
 * dountil 루프:
 *   classify-intent(suspend 가능) → branch(simple|agent) → quality-check
 *   - quality-check 통과: source !== "retry" → 루프 종료
 *   - quality-check 실패: source === "retry" → 루프 재시작
 *   - classify-intent에서 clarify/ambiguous → suspend → 사용자 입력 후 resume
 *
 * 루프 종료 후:
 *   synthesize-response → 최종 사용자 응답 합성
 *
 * HITL 타입:
 *   - clarify: 정보 부족 → 어시스턴트 질문 메시지
 *   - ambiguous: 라우팅 모호 → Agent 선택 카드
 *   - 자동 재시도: 품질 낮음 → Classifier가 피드백 기반으로 자동 개선
 */
export const chatWorkflow = createWorkflow({
  id: "chat-workflow",
  inputSchema: loopIOSchema,
  outputSchema: z.object({
    response: z.string(),
  }),
  stateSchema: workflowStateSchema,
})
  .dountil(
    classifyAndExecuteWorkflow,
    async ({ inputData, iterationCount }) => {
      // 최대 루프 횟수 초과 시 강제 종료
      if (iterationCount >= MAX_LOOP_ITERATIONS) return true;
      // retry가 아니면 (통과 또는 direct) 루프 종료
      return inputData.source !== "retry";
    },
  )
  .then(synthesizeResponseStep)
  .commit();
