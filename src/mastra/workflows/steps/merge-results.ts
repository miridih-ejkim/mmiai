import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";

/**
 * .parallel() 출력 스키마
 * 각 병렬 Step의 ID를 키로, agentResultSchema를 값으로 가짐
 */
const parallelOutputSchema = z.object({
  "parallel-atlassian": agentResultSchema,
  "parallel-google-search": agentResultSchema,
  "parallel-datahub": agentResultSchema,
});

/**
 * Merge Results Step
 * .parallel() 병렬 실행 결과를 하나의 agentResultSchema로 통합
 * success: true인 결과만 병합하여 반환
 */
export const mergeResultsStep = createStep({
  id: "merge-results",
  inputSchema: parallelOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData }) => {
    const results = [
      inputData["parallel-atlassian"],
      inputData["parallel-google-search"],
      inputData["parallel-datahub"],
    ].filter((r) => r.success && r.content.length > 0);

    if (results.length === 0) {
      return {
        source: "multi-agent",
        content: "모든 Agent 호출에서 결과를 가져오지 못했습니다.",
        success: false,
      };
    }

    const mergedContent = results
      .map((r) => `[${r.source}]\n${r.content}`)
      .join("\n\n---\n\n");

    return {
      source: "multi-agent",
      content: mergedContent,
      success: true,
    };
  },
});
