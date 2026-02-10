import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";

/** 최소 응답 길이 (이 이하면 품질 불충분으로 판단) */
const MIN_CONTENT_LENGTH = 20;

/**
 * 간단한 품질 점수 계산 (0-1)
 *
 * 규칙 기반으로 빠르게 평가 (LLM 호출 없음):
 * - 빈 content: 0
 * - 매우 짧은 content: 0.1-0.3
 * - 사용자 질문의 키워드가 응답에 포함되어 있는지: +0.3
 * - 충분한 길이: +0.4
 */
function computeQualityScore(
  content: string,
  userMessage: string,
): number {
  if (!content || content.trim().length === 0) return 0;

  let score = 0;

  // 길이 기반 점수 (최대 0.4)
  const len = content.trim().length;
  if (len > 200) score += 0.4;
  else if (len > 100) score += 0.3;
  else if (len > MIN_CONTENT_LENGTH) score += 0.2;
  else score += 0.1;

  // 키워드 커버리지 (최대 0.3)
  const keywords = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (keywords.length > 0) {
    const contentLower = content.toLowerCase();
    const covered = keywords.filter((k) => contentLower.includes(k)).length;
    score += (covered / keywords.length) * 0.3;
  } else {
    score += 0.3;
  }

  // 구조적 품질 (최대 0.3): 줄바꿈, 리스트, 링크 등이 있으면 가산
  if (content.includes("\n")) score += 0.1;
  if (/[-*]\s/.test(content)) score += 0.1;
  if (/https?:\/\/|urn:/.test(content)) score += 0.1;

  return Math.min(score, 1);
}

/** Quality Check 임계값 */
const QUALITY_THRESHOLD = 0.3;

/**
 * Quality Check Step
 *
 * Agent 실행 결과의 품질을 평가하고, 낮으면 suspend하여 사용자 피드백을 요청한다.
 *
 * 1. 규칙 기반 체크: success === false 또는 빈 content → 즉시 suspend
 * 2. 품질 점수: 길이, 키워드 커버리지, 구조적 품질 → score < threshold → suspend
 * 3. Resume 시: inputData.source로 Agent를 식별하고 사용자 피드백으로 재실행
 */
export const qualityCheckStep = createStep({
  id: "quality-check",
  inputSchema: agentResultSchema,
  outputSchema: agentResultSchema,
  resumeSchema: z.object({
    userFeedback: z.string().describe("사용자가 제공한 추가 지시/수정된 쿼리"),
  }),
  suspendSchema: z.object({
    reason: z.string().describe("suspend 사유"),
    score: z.number().describe("품질 점수 (0-1)"),
    originalSource: z.string().describe("결과 출처 Agent"),
  }),
  execute: async ({ inputData, resumeData, suspend, mastra, getInitData }) => {
    const initData = getInitData<{ message: string }>();

    // === Resume 경로: 사용자 피드백으로 Agent 재실행 ===
    if (resumeData?.userFeedback) {
      const agentMap: Record<string, string> = {
        atlassian: "atlassianAgent",
        "google-search": "googleSearchAgent",
        datahub: "dataHubAgent",
      };
      const agentId = agentMap[inputData.source];

      if (agentId) {
        try {
          const agent = mastra!.getAgent(agentId);
          const result = await agent.generate(resumeData.userFeedback);
          return {
            source: inputData.source,
            content: result.text,
            success: true,
          };
        } catch (error) {
          return {
            source: inputData.source,
            content: `재실행 오류: ${error instanceof Error ? error.message : String(error)}`,
            success: false,
          };
        }
      }

      // direct 또는 unknown source는 피드백을 content로 사용
      return {
        source: inputData.source,
        content: resumeData.userFeedback,
        success: true,
      };
    }

    // === 규칙 기반 체크 ===
    if (!inputData.success || inputData.content.trim().length === 0) {
      return await suspend({
        reason: "Agent 실행이 실패했거나 결과가 비어있습니다.",
        score: 0,
        originalSource: inputData.source,
      });
    }

    // === direct 응답은 품질 체크 스킵 (인사말 등 단순 응답) ===
    if (inputData.source === "direct") {
      return inputData;
    }

    // === 품질 점수 평가 ===
    const userMessage = initData?.message || "";
    const score = computeQualityScore(inputData.content, userMessage);

    if (score < QUALITY_THRESHOLD) {
      return await suspend({
        reason: `결과 품질이 낮습니다 (score: ${score.toFixed(2)}).`,
        score,
        originalSource: inputData.source,
      });
    }

    // === 통과 ===
    return inputData;
  },
});
