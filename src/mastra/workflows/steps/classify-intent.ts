import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { MCP_REGISTRY, getAllMcpIds } from "../../mcp";

/**
 * Sequential 모드에서 각 단계의 구조화된 쿼리
 * goal과 contextHint로 단계 간 맥락 전달을 강화
 */
export const sequentialQuerySchema = z.object({
  query: z.string().describe("이 Agent에게 전달할 기본 쿼리"),
  goal: z.string().describe("이 단계의 목표 (예: '데이터 관련 문서를 찾고 테이블 이름 추출')"),
  contextHint: z
    .string()
    .optional()
    .describe(
      "이전 단계 결과에서 참고할 정보 (예: '테이블 이름, URN'). 첫 번째 단계에서는 생략",
    ),
});

export type SequentialQuery = z.infer<typeof sequentialQuerySchema>;

/**
 * 의도 분류 결과 스키마
 * Classifier Agent의 structured output으로 사용
 *
 * type: "simple" (직접 응답) 또는 "agent" (MCP Worker 호출)
 * targets: 호출할 MCP ID 목록 (1개 = single, 2개+ = multi)
 * queries: parallel이면 string, sequential이면 { query, goal, contextHint } 객체
 */
export const classificationOutputSchema = z.object({
  type: z.enum(["simple", "agent"]),
  targets: z
    .array(z.string())
    .describe("호출할 MCP ID 목록 ([AVAILABLE AGENTS]에서 선택)"),
  queries: z
    .record(z.string(), z.union([z.string(), sequentialQuerySchema]))
    .describe(
      "각 agent에게 전달할 쿼리. parallel/single이면 string, sequential이면 {query, goal, contextHint} 객체",
    ),
  reasoning: z.string().describe("분류 판단 근거"),
  executionMode: z
    .enum(["parallel", "sequential"])
    .default("parallel")
    .describe(
      "targets 2개 이상일 때 실행 모드: parallel(독립 질문), sequential(의존성 있는 순차 질문)",
    ),
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

/**
 * 분류 결과를 활성 MCP 목록에 맞게 검증/보정합니다.
 *
 * - 비활성 MCP를 targets에서 제거
 * - targets가 비어지면 simple로 변경
 */
function validateClassification(
  result: ClassificationOutput,
  activeMcpIds: string[],
): ClassificationOutput {
  // simple은 검증 불필요
  if (result.type === "simple") return result;

  // targets에서 비활성 MCP 제거
  const filteredTargets = result.targets.filter((t) =>
    activeMcpIds.includes(t),
  );

  // 유효 targets가 0개 → simple로 변경
  if (filteredTargets.length === 0) {
    return {
      ...result,
      type: "simple",
      targets: [],
      queries: {},
      reasoning: `${result.reasoning} (모든 대상 Agent가 비활성 상태이므로 simple로 변경)`,
    };
  }

  return {
    ...result,
    targets: filteredTargets,
  };
}

/**
 * Step 1: 의도 분류
 *
 * Classifier Agent (Haiku)를 사용하여 사용자 메시지를 분류합니다.
 * 활성 MCP 목록을 동적으로 프롬프트에 주입하여, 사용 가능한 Agent만 대상으로 분류합니다.
 */
export const classifyIntentStep = createStep({
  id: "classify-intent",
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: classificationOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const activeMcpIds =
      (requestContext?.get("activeMcpIds") as string[] | undefined) ||
      getAllMcpIds();

    // 활성 MCP만 포함한 동적 프롬프트 구성
    const activeAgentDescriptions = MCP_REGISTRY.filter((entry) =>
      activeMcpIds.includes(entry.id),
    )
      .map(
        (entry) =>
          `- "${entry.id}": ${entry.description}`,
      )
      .join("\n");

    const dynamicPrompt = `${inputData.message}

[AVAILABLE AGENTS]
${activeAgentDescriptions || "(none — classify as simple)"}

IMPORTANT: You may ONLY route to agents listed above. If no agents are available, classify as "simple".`;

    // Memory 연동: userId(resource) + threadId(thread)로 대화 맥락 유지
    const userId =
      (requestContext?.get("userId") as string | undefined) || "default-user";
    const threadId =
      (requestContext?.get("threadId") as string | undefined) ||
      "default-thread";

    const classifier = mastra!.getAgent("classifierAgent");
    const result = await classifier.generate(dynamicPrompt, {
      memory: {
        resource: userId,
        thread: threadId,
      },
      structuredOutput: {
        schema: classificationOutputSchema,
      },
    });

    // 후처리: 비활성 MCP 필터링
    return validateClassification(
      result.object as ClassificationOutput,
      activeMcpIds,
    );
  },
});
