import { createStep } from "@mastra/core/workflows";
import { z } from "zod";

/**
 * 의도 분류 결과 스키마
 * Classifier Agent의 structured output으로 사용
 */
export const classificationOutputSchema = z.object({
  type: z.enum([
    "simple",
    "atlassian",
    "google-search",
    "datahub",
    "multi-agent",
  ]),
  targets: z
    .array(z.enum(["atlassian", "google-search", "datahub"]))
    .describe("호출할 agent ID 목록"),
  queries: z
    .record(z.string(), z.string())
    .describe("각 agent에게 전달할 정제된 쿼리 (Key: agent ID, Value: query)"),
  reasoning: z.string().describe("분류 판단 근거"),
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

/**
 * Step 1: 의도 분류
 *
 * Classifier Agent (Haiku)를 사용하여 사용자 메시지를 분류합니다.
 * structured output으로 type, targets, queries, reasoning을 반환합니다.
 */
export const classifyIntentStep = createStep({
  id: "classify-intent",
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: classificationOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const classifier = mastra!.getAgent("classifierAgent");
    const result = await classifier.generate(inputData.message, {
      structuredOutput: {
        schema: classificationOutputSchema,
      },
    });
    return result.object as ClassificationOutput;
  },
});
