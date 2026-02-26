import { createStep } from "@mastra/core/workflows";
import { agentResultSchema } from "./agent-steps";
import { workflowStateSchema } from "../state";
import { qualityScorer } from "../../scorers";

/** Quality Check 임계값 */
const QUALITY_THRESHOLD = 0.9;

/**
 * Quality Check Step — 순수한 품질 게이트
 *
 * Mastra Quality Scorer로 Agent 응답 품질을 평가합니다.
 * - Completeness (0.4): 사용자 키워드 커버 비율
 * - Keyword Coverage (0.3): stop word 필터링 후 매칭율
 * - Structural Quality (0.3): 길이 + 구조적 요소
 *
 * - 통과: 결과를 그대로 다음 Step으로 전달
 * - 실패: source="retry" + scorer reason 포함 피드백 반환 → dountil 루프백
 *
 * HITL 판단은 classify-intent Step이 담당합니다.
 */
export const qualityCheckStep = createStep({
  id: "quality-check",
  inputSchema: agentResultSchema,
  outputSchema: agentResultSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, getInitData, state, setState }) => {
    const initData = getInitData<{ message: string }>();
    const originalMessage = initData?.message || "";

    const currentState = state ?? {
      executionTargets: [],
      executionMode: "parallel" as const,
    };

    // === direct 응답은 품질 체크 스킵 (인사말 등 단순 응답) ===
    if (inputData.source === "direct") {
      setState({ ...currentState, previousFeedback: undefined });
      return inputData;
    }

    // === 실패 → retry ===
    if (!inputData.success || inputData.content.trim().length === 0) {
      const feedback = `Agent 실행이 실패했거나 결과가 비어있습니다.\n실행 대상: ${inputData.source}\n원본 질문: ${originalMessage}`;
      setState({ ...currentState, previousFeedback: feedback });
      return {
        source: "retry",
        content: feedback,
        success: false,
      };
    }

    // === Scorer 기반 품질 평가 ===
    const scorerResult = await qualityScorer.run({
      input: {
        userMessage: originalMessage,
        content: inputData.content,
        source: inputData.source,
      },
      output: { content: inputData.content },
    });
    const score = scorerResult.score;

    if (score < QUALITY_THRESHOLD) {
      const reason = scorerResult.reason || `score: ${score.toFixed(2)}`;
      const feedback = `품질 부족 (${reason}).\n실행 대상: ${inputData.source}\n원본 결과 (일부):\n${inputData.content.slice(0, 500)}\n원본 질문: ${originalMessage}`;
      setState({ ...currentState, previousFeedback: feedback });
      return {
        source: "retry",
        content: feedback,
        success: false,
      };
    }

    // === 통과 — 피드백 초기화 ===
    setState({ ...currentState, previousFeedback: undefined });
    return inputData;
  },
});
