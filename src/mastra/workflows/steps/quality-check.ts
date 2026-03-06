import { createStep } from "@mastra/core/workflows";
import { agentResultSchema } from "./agent-steps";
import { workflowStateSchema, type RetryEntry } from "../state";
import { qualityScorer } from "../../scorers";

/** Quality Check 임계값 */
const QUALITY_THRESHOLD = 0.4;

/**
 * Quality Check Step — 2단계 품질 게이트
 *
 * 1단계 (코드): 실행 실패 / 빈 결과 → 즉시 FAIL (LLM 호출 없음)
 * 2단계 (LLM): qualityScorer (Haiku Judge) → 의미 기반 평가
 *   - Relevance (0.35): 응답이 질문에 실제로 답하는가
 *   - Completeness (0.30): 질문의 모든 측면을 다루는가
 *   - Usefulness (0.20): 실질적 정보 vs "결과 없음" 응답
 *   - Coherence (0.15): 구조, 가독성, 논리적 조직화
 *
 * - 통과: 결과를 그대로 다음 Step으로 전달
 * - 실패: source="retry" + retryHistory 누적 → dountil 루프백
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
    const originalMessage = state?.originalMessage || initData?.message || "";
    // clarify resume 시 사용자가 제공한 추가 정보 (workflow state에 구조화 저장)
    const clarifyAnswer = state?.clarifyAnswer;
    // 품질 평가에 사용할 전체 사용자 의도 (원본 질문 + clarify 답변)
    const fullUserIntent = clarifyAnswer
      ? `${originalMessage} (사용자 추가 정보: ${clarifyAnswer})`
      : originalMessage;

    const currentState = state ?? {
      executionTargets: [],
      executionMode: "parallel" as const,
    };
    const retryCount = currentState.retryCount ?? 0;
    const retryHistory = currentState.retryHistory ?? [];

    // === direct 응답은 품질 체크 스킵 (인사말 등 단순 응답) ===
    if (inputData.source === "direct") {
      setState({ ...currentState, previousFeedback: undefined });
      return inputData;
    }

    // 재시도 이력 항목 생성 헬퍼
    const createRetryEntry = (reason: string): RetryEntry => ({
      attempt: retryCount + 1,
      targets: currentState.executionTargets ?? [],
      executionMode: currentState.executionMode ?? "parallel",
      queries: currentState.executionQueries ?? [],
      reason,
      confidence: inputData.confidence ?? undefined,
    });

    // === 실패 → retry ===
    if (!inputData.success || inputData.content.trim().length === 0) {
      const reason = "Agent 실행 실패 또는 빈 결과";
      const feedback = `Agent 실행이 실패했거나 결과가 비어있습니다.\n실행 대상: ${inputData.source}\n원본 질문: ${fullUserIntent}`;

      const entry = createRetryEntry(reason);
      setState({
        ...currentState,
        previousFeedback: feedback,
        retryCount: retryCount + 1,
        retryHistory: [...retryHistory, entry],
      });
      return {
        source: "retry",
        content: feedback,
        success: false,
      };
    }

    // === Scorer 기반 품질 평가 ===
    // LLM structured output이 부분적/실패할 수 있으므로 try/catch
    let score: number;
    let scorerReason: string | undefined;
    try {
      const scorerResult = await qualityScorer.run({
        input: {
          userMessage: fullUserIntent,
          content: inputData.content,
          source: inputData.source,
        },
        output: { content: inputData.content },
      });
      score = scorerResult.score;
      scorerReason = scorerResult.reason;
    } catch (err: any) {
      // Structured output 검증 실패 시: 부분 결과에서 복구 시도
      console.warn("[quality-check] Scorer failed, attempting recovery:", err?.message);

      // err.details.value에 LLM의 partial JSON이 있을 수 있음
      if (err?.details?.value || err?.cause) {
        try {
          const raw = err?.details?.value
            ? (typeof err.details.value === "string"
                ? JSON.parse(err.details.value)
                : err.details.value)
            : null;

          if (raw?.relevance?.score != null) {
            // 부분 결과에서 가능한 차원만으로 점수 계산
            const r = raw.relevance?.score ?? 0;
            const c = raw.completeness?.score ?? 0;
            const u = raw.usefulness?.score ?? 0;
            const co = raw.coherence?.score ?? 0;
            score = r * 0.35 + c * 0.3 + u * 0.2 + co * 0.15;
            score = Math.round(score * 100) / 100;
            scorerReason = `부분 평가 (scorer 오류 복구): relevance=${r}`;
            console.warn("[quality-check] Recovered partial score:", score);
          } else {
            // 복구 불가 → confidence 기반 fallback
            score = inputData.confidence ?? 0.5;
            scorerReason = `Scorer 오류로 Worker confidence(${score}) 사용`;
            console.warn("[quality-check] No partial result, using confidence fallback:", score);
          }
        } catch {
          score = inputData.confidence ?? 0.5;
          scorerReason = `Scorer 오류 복구 실패, Worker confidence(${score}) 사용`;
          console.warn("[quality-check] Recovery parse failed, using confidence fallback:", score);
        }
      } else {
        // details 없음 → confidence fallback
        score = inputData.confidence ?? 0.5;
        scorerReason = `Scorer 실행 오류, Worker confidence(${score}) 사용`;
        console.warn("[quality-check] No error details, using confidence fallback:", score);
      }
    }

    if (score < QUALITY_THRESHOLD) {
      const reason = scorerReason || `score: ${score.toFixed(2)}`;
      const feedback = `품질 부족 (${reason}).\n실행 대상: ${inputData.source}\n원본 결과 (일부):\n${inputData.content.slice(0, 500)}\n원본 질문: ${fullUserIntent}`;

      const entry = createRetryEntry(`품질 부족: ${reason}`);
      setState({
        ...currentState,
        previousFeedback: feedback,
        retryCount: retryCount + 1,
        retryHistory: [...retryHistory, entry],
      });
      return {
        source: "retry",
        content: feedback,
        success: false,
      };
    }

    // === 통과 — 피드백 초기화 (retryHistory는 유지) ===
    setState({ ...currentState, previousFeedback: undefined });
    return inputData;
  },
});
