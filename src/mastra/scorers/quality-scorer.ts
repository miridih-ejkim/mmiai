/**
 * Quality Scorer — Agent 응답 품질 평가
 *
 * quality-check Step에서 computeQualityScore()를 대체합니다.
 * Mastra createScorer() API를 사용한 code-based scorer (LLM 호출 없음).
 *
 * 평가 축:
 * - Completeness (0.4): 사용자 키워드가 응답에 얼마나 포함되었는지
 * - Keyword Coverage (0.3): stop word 필터링 후 키워드 매칭율
 * - Structural Quality (0.3): 길이 + 구조적 요소 (줄바꿈, 리스트, 링크)
 */
import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractKeywords } from "./utils";

const qualityInputSchema = z.object({
  userMessage: z.string(),
  content: z.string(),
  source: z.string(),
});

const qualityOutputSchema = z.object({
  content: z.string(),
});

export const qualityScorer = createScorer({
  id: "quality-scorer",
  description:
    "Agent 응답의 품질을 completeness, keyword coverage, structure 기준으로 평가",
  type: {
    input: qualityInputSchema,
    output: qualityOutputSchema,
  },
})
  .preprocess(({ run }) => {
    const input = run.input!;
    const content = input.content;

    const inputKeywords = extractKeywords(input.userMessage);
    const outputKeywords = extractKeywords(content);

    const trimmed = content.trim();
    return {
      inputKeywords,
      outputKeywords,
      contentLength: trimmed.length,
      hasNewlines: trimmed.includes("\n"),
      hasLists: /[-*]\s/.test(trimmed),
      hasLinks: /https?:\/\/|urn:/.test(trimmed),
    };
  })
  .analyze(({ results }) => {
    const {
      inputKeywords,
      outputKeywords,
      contentLength,
      hasNewlines,
      hasLists,
      hasLinks,
    } = results.preprocessStepResult;

    // === Completeness (0-1): input 키워드가 output에 포함된 비율 ===
    let completenessScore = 1.0;
    const missingElements: string[] = [];

    if (inputKeywords.length > 0) {
      const outputSet = new Set(outputKeywords);
      // content 전체에서도 검색 (outputKeywords는 토큰화된 것이므로 부분 매칭 보완)
      const contentLower = (results as any)
        ? ""
        : ""; // placeholder — 아래에서 직접 접근
      let covered = 0;
      for (const keyword of inputKeywords) {
        if (keyword.length <= 3) {
          // 짧은 키워드: exact match in outputKeywords set
          if (outputSet.has(keyword)) {
            covered++;
          } else {
            missingElements.push(keyword);
          }
        } else {
          // 긴 키워드: output keywords에 포함되었거나 content에 포함
          if (
            outputSet.has(keyword) ||
            outputKeywords.some((ok) => ok.includes(keyword) || keyword.includes(ok))
          ) {
            covered++;
          } else {
            missingElements.push(keyword);
          }
        }
      }
      completenessScore = covered / inputKeywords.length;
    }

    // === Keyword Coverage (0-1): stop-word 필터링된 매칭율 ===
    // extractKeywords가 이미 stop word를 제거하므로 inputKeywords를 그대로 사용
    let keywordCoverageScore = 1.0;
    if (inputKeywords.length > 0) {
      const outputLower = outputKeywords.join(" ");
      const matched = inputKeywords.filter((k) => outputLower.includes(k)).length;
      keywordCoverageScore = matched / inputKeywords.length;
    }

    // === Structural Quality (0-1) ===
    // Length component (60% of structural)
    let lengthComponent = 0;
    if (contentLength > 200) lengthComponent = 1.0;
    else if (contentLength > 100) lengthComponent = 0.6;
    else if (contentLength > 20) lengthComponent = 0.3;
    else if (contentLength > 0) lengthComponent = 0.1;

    // Structure bonus (40% of structural)
    let structureBonus = 0;
    if (hasNewlines) structureBonus += 0.33;
    if (hasLists) structureBonus += 0.33;
    if (hasLinks) structureBonus += 0.34;

    const structuralScore = lengthComponent * 0.6 + structureBonus * 0.4;

    return {
      completenessScore,
      keywordCoverageScore,
      structuralScore,
      missingElements,
    };
  })
  .generateScore(({ results }) => {
    const { completenessScore, keywordCoverageScore, structuralScore } =
      results.analyzeStepResult;

    const score =
      completenessScore * 0.4 +
      keywordCoverageScore * 0.3 +
      structuralScore * 0.3;

    return Math.min(Math.max(score, 0), 1);
  })
  .generateReason(({ results, score }) => {
    const {
      completenessScore,
      keywordCoverageScore,
      structuralScore,
      missingElements,
    } = results.analyzeStepResult;

    let reason = `Score ${score.toFixed(2)}: completeness=${completenessScore.toFixed(2)}, keywords=${keywordCoverageScore.toFixed(2)}, structure=${structuralScore.toFixed(2)}`;

    if (missingElements.length > 0) {
      reason += ` (missing: ${missingElements.slice(0, 5).join(", ")})`;
    }

    return reason;
  });
