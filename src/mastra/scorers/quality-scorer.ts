/**
 * Quality Scorer — LLM 기반 Agent 응답 품질 평가
 *
 * quality-check Step에서 사용합니다.
 * Mastra createScorer() API + PromptObject로 Haiku가 의미 기반 평가.
 *
 * Pipeline: analyze (LLM) → generateScore (code) → generateReason (code)
 *
 * 평가 차원:
 * - Relevance (0.35): 응답이 사용자 질문에 실제로 답하는가
 * - Completeness (0.30): 질문의 모든 측면을 다루는가
 * - Usefulness (0.20): 실질적 정보 제공 vs "결과 없음" 응답
 * - Coherence (0.15): 구조, 가독성, 논리적 조직화
 */
import { createScorer } from "@mastra/core/evals";
import { z } from "zod";

const qualityInputSchema = z.object({
  userMessage: z.string(),
  content: z.string(),
  source: z.string(),
});

const qualityOutputSchema = z.object({
  content: z.string(),
});

/** LLM analyze step 출력 스키마 */
const analyzeOutputSchema = z.object({
  relevance: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe("0-1, how well the response addresses the user's actual question"),
    reason: z.string().describe("Korean, max 15 words"),
  }),
  completeness: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe("0-1, how thoroughly all aspects of the question are covered"),
    reason: z.string().describe("Korean, max 15 words"),
  }),
  usefulness: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "0-1, whether the response provides actionable information vs empty/error/no-results",
      ),
    reason: z.string().describe("Korean, max 15 words"),
  }),
  coherence: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe("0-1, structural quality, readability, logical organization"),
    reason: z.string().describe("Korean, max 15 words"),
  }),
  improvementSuggestion: z
    .string()
    .describe(
      "What specific action should the system take to improve the response? Write in Korean, be specific and actionable.",
    ),
});

export const qualityScorer = createScorer({
  id: "quality-scorer",
  description:
    "LLM 기반 Agent 응답 품질 평가 (relevance, completeness, usefulness, coherence)",
  judge: {
    model: "anthropic/claude-haiku-4-5",
    instructions: `You are a strict quality evaluator for AI agent responses.
Your job is to assess whether an agent's response adequately answers the user's question.

Key evaluation principles:
1. A response that says "검색 결과 없음", "찾을 수 없습니다", "관련 정보를 찾지 못했습니다" or similar MUST receive usefulness score of 0.0
2. A response must actually address the USER'S question, not just contain related information
3. Evaluate the MEANING and INTENT, not surface-level keyword overlap
4. A long response is not automatically good — it must be relevant and useful
5. Responses in Korean, English, or mixed are all acceptable — evaluate by content quality
6. Consider the source context: agent responses should provide specific data, not generic advice`,
  },
  type: {
    input: qualityInputSchema,
    output: qualityOutputSchema,
  },
})
  .analyze({
    description: "Evaluate the response quality across 4 dimensions",
    outputSchema: analyzeOutputSchema,
    createPrompt: ({ run }) => {
      const input = run.input!;
      return `## User Question
${input.userMessage}

## Agent Response (source: ${input.source})
${input.content.slice(0, 3000)}

## Evaluation Task
Evaluate the agent response against the user's question on these 4 dimensions.
Each dimension gets a score from 0.0 to 1.0.

### Dimensions:
1. **relevance**: Does the response address what the user actually asked? (0 = completely off-topic, 1 = perfectly on-topic)
2. **completeness**: Are all aspects of the question covered? (0 = nothing covered, 1 = fully covered)
3. **usefulness**: Does the response provide actionable, concrete information? (0 = "no results found"/error/empty, 1 = highly informative)
4. **coherence**: Is the response well-structured and readable? (0 = incomprehensible, 1 = perfectly organized)

### Critical Rules:
- If the response essentially says "no results" or "couldn't find anything" → usefulness MUST be 0.0
- If the response discusses a completely different topic → relevance MUST be 0.0
- Be strict: only give scores above 0.7 if the dimension is genuinely well-satisfied

### improvementSuggestion:
Write ONE specific, actionable suggestion in Korean for how the system could improve this response.
Examples: "더 구체적인 검색 키워드 사용 필요", "다른 Agent(datahub) 활용 필요", "검색 범위를 넓혀서 재시도 필요"

### IMPORTANT — Output Format:
You MUST return ALL 5 fields: relevance, completeness, usefulness, coherence, improvementSuggestion.
Keep each reason under 15 words. Do NOT skip any field.`;
    },
  })
  .generateScore(({ results }) => {
    const analysis = results.analyzeStepResult;
    if (!analysis) return 0;

    const score =
      analysis.relevance.score * 0.35 +
      analysis.completeness.score * 0.3 +
      analysis.usefulness.score * 0.2 +
      analysis.coherence.score * 0.15;

    return Math.round(score * 100) / 100;
  })
  .generateReason(({ results, score }) => {
    const analysis = results.analyzeStepResult;
    if (!analysis) return `Score ${score}: 분석 실패`;

    const dimensions = [
      `relevance=${analysis.relevance.score.toFixed(2)}`,
      `completeness=${analysis.completeness.score.toFixed(2)}`,
      `usefulness=${analysis.usefulness.score.toFixed(2)}`,
      `coherence=${analysis.coherence.score.toFixed(2)}`,
    ].join(", ");

    const lowDimensions: string[] = [];
    if (analysis.relevance.score < 0.5)
      lowDimensions.push(`관련성: ${analysis.relevance.reason}`);
    if (analysis.completeness.score < 0.5)
      lowDimensions.push(`완성도: ${analysis.completeness.reason}`);
    if (analysis.usefulness.score < 0.5)
      lowDimensions.push(`유용성: ${analysis.usefulness.reason}`);
    if (analysis.coherence.score < 0.5)
      lowDimensions.push(`일관성: ${analysis.coherence.reason}`);

    let reason = `Score ${score.toFixed(2)}: ${dimensions}`;
    if (lowDimensions.length > 0) {
      reason += `\n부족한 영역: ${lowDimensions.join("; ")}`;
    }
    reason += `\n개선 방향: ${analysis.improvementSuggestion}`;

    return reason;
  });
