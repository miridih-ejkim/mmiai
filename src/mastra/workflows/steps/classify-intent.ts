import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { MCP_REGISTRY, getAllMcpIds } from "../../mcp";
import { workflowStateSchema } from "../state";

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
 * type: "simple" | "agent" | "clarify" | "ambiguous"
 * - simple: 직접 응답 (외부 데이터 불필요)
 * - agent: MCP Worker 호출 (targets/queries 포함)
 * - clarify: 정보 부족 — 사용자에게 질문 (clarifyQuestion 포함)
 * - ambiguous: 라우팅 모호 — 사용자에게 Agent 선택 요청 (candidates 포함)
 */
export const classificationOutputSchema = z.object({
  type: z.enum(["simple", "agent", "clarify", "ambiguous"]),
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
  clarifyQuestion: z
    .string()
    .optional()
    .describe("clarify 타입일 때 사용자에게 물어볼 질문"),
  candidates: z
    .array(
      z.object({
        planId: z
          .string()
          .describe(
            "고유 Plan ID (예: 'datahub-only', 'datahub-analyst-seq')",
          ),
        label: z
          .string()
          .describe("UI 버튼에 노출될 짧은 텍스트 (예: '스키마 조회')"),
        description: z
          .string()
          .describe("이 계획의 상세 설명"),
        targets: z
          .array(z.string())
          .describe("이 계획에서 호출할 Agent MCP ID 목록"),
        executionMode: z
          .enum(["parallel", "sequential"])
          .default("parallel")
          .describe("이 계획의 실행 모드"),
        expectedOutcome: z
          .string()
          .describe("실행 후 예상 결과물 (예: '테이블 스키마 정보')"),
      }),
    )
    .optional()
    .describe("ambiguous 타입일 때 후보 실행 계획 목록"),
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

/** Candidate 타입 (plan-level) */
export type PlanCandidate = NonNullable<
  ClassificationOutput["candidates"]
>[number];

// ─── Suspend / Resume Schemas ───

const classifyIntentSuspendSchema = z.object({
  hitlType: z.enum(["clarify", "ambiguous"]),
  clarifyQuestion: z.string().optional(),
  candidates: z
    .array(
      z.object({
        planId: z.string(),
        label: z.string(),
        description: z.string(),
        targets: z.array(z.string()),
        executionMode: z.enum(["parallel", "sequential"]).default("parallel"),
        expectedOutcome: z.string(),
      }),
    )
    .optional(),
  originalMessage: z.string(),
});

const classifyIntentResumeSchema = z.object({
  /** clarify: 사용자의 답변 */
  userAnswer: z.string().optional(),
  /** ambiguous: 사용자가 선택한 Plan ID */
  selectedPlan: z.string().optional(),
  /** ambiguous: 선택된 plan의 targets (UI에서 candidate 데이터와 함께 전송) */
  selectedTargets: z.array(z.string()).optional(),
  /** ambiguous: 선택된 plan의 executionMode */
  selectedExecutionMode: z.enum(["parallel", "sequential"]).optional(),
});

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
  // simple/clarify/ambiguous는 검증 불필요
  if (result.type !== "agent") return result;

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
 * Step 1: 의도 분류 (HITL suspend 지원)
 *
 * Classifier Agent를 사용하여 사용자 메시지를 분류합니다.
 * - simple/agent: 기존 로직대로 return
 * - clarify: suspend → 사용자 답변 후 resume → 재분류
 * - ambiguous: suspend → 사용자 Agent 선택 후 resume → 선택된 Agent로 분류
 *
 * dountil 루프에서 quality-check 실패 시 state.previousFeedback을 참조하여
 * [PREVIOUS FEEDBACK] 섹션을 프롬프트에 포함합니다.
 */
export const classifyIntentStep = createStep({
  id: "classify-intent",
  inputSchema: z.object({
    message: z.string().optional(),
    source: z.string().optional(),
    content: z.string().optional(),
    success: z.boolean().optional(),
  }),
  outputSchema: classificationOutputSchema,
  suspendSchema: classifyIntentSuspendSchema,
  resumeSchema: classifyIntentResumeSchema,
  stateSchema: workflowStateSchema,
  execute: async ({
    inputData,
    resumeData,
    suspend,
    mastra,
    requestContext,
    getInitData,
    state,
  }) => {
    const activeMcpIds =
      (requestContext?.get("activeMcpIds") as string[] | undefined) ||
      getAllMcpIds();

    const userId =
      (requestContext?.get("userId") as string | undefined) || "default-user";
    const threadId =
      (requestContext?.get("threadId") as string | undefined) ||
      "default-thread";

    const initData = getInitData<{ message: string }>();
    const originalMessage = initData?.message || inputData.message || "";

    // === Resume 경로 ===
    if (resumeData) {
      // clarify: 사용자 답변 → 원본 + 답변 결합하여 재분류
      if (resumeData.userAnswer) {
        const enrichedMessage = `${originalMessage}\n\n사용자 추가 정보: ${resumeData.userAnswer}`;
        return await classifyMessage({
          message: enrichedMessage,
          activeMcpIds,
          userId,
          threadId,
          mastra: mastra!,
          previousFeedback: undefined,
        });
      }

      // ambiguous: 사용자가 Plan 선택 → 선택된 계획의 targets/executionMode로 실행
      if (resumeData.selectedPlan) {
        const targets = resumeData.selectedTargets || [];
        const executionMode =
          resumeData.selectedExecutionMode || ("parallel" as const);

        // targets가 없으면 원본 메시지로 재분류
        if (targets.length === 0) {
          return await classifyMessage({
            message: `${originalMessage}\n\n사용자가 선택한 계획: ${resumeData.selectedPlan}`,
            activeMcpIds,
            userId,
            threadId,
            mastra: mastra!,
            previousFeedback: undefined,
          });
        }

        const queries: Record<string, string> = {};
        for (const t of targets) {
          queries[t] = originalMessage;
        }

        return {
          type: "agent" as const,
          targets,
          queries,
          reasoning: `사용자가 계획 "${resumeData.selectedPlan}"을(를) 선택함`,
          executionMode,
        };
      }
    }

    // === 일반 분류 경로 ===
    const previousFeedback = state?.previousFeedback;

    const classification = await classifyMessage({
      message: originalMessage,
      activeMcpIds,
      userId,
      threadId,
      mastra: mastra!,
      previousFeedback,
    });

    // clarify → suspend
    if (classification.type === "clarify") {
      return await suspend({
        hitlType: "clarify",
        clarifyQuestion:
          classification.clarifyQuestion || "추가 정보를 알려주세요.",
        originalMessage,
      });
    }

    // ambiguous → suspend
    if (classification.type === "ambiguous") {
      return await suspend({
        hitlType: "ambiguous",
        candidates: classification.candidates || [],
        originalMessage,
      });
    }

    // simple/agent → return
    return classification;
  },
});

// ─── 분류 헬퍼 ───

async function classifyMessage(params: {
  message: string;
  activeMcpIds: string[];
  userId: string;
  threadId: string;
  mastra: any;
  previousFeedback: string | undefined;
}): Promise<ClassificationOutput> {
  const {
    message,
    activeMcpIds,
    userId,
    threadId,
    mastra,
    previousFeedback,
  } = params;

  // 활성 MCP만 포함한 동적 프롬프트 구성
  const activeAgentDescriptions = MCP_REGISTRY.filter((entry) =>
    activeMcpIds.includes(entry.id),
  )
    .map((entry) => `- "${entry.id}": ${entry.description}`)
    .join("\n");

  let dynamicPrompt = `${message}

[AVAILABLE AGENTS]
${activeAgentDescriptions || "(none — classify as simple)"}`;

  // 이전 루프 피드백이 있으면 추가
  if (previousFeedback) {
    dynamicPrompt += `

[PREVIOUS FEEDBACK]
이전 실행 결과가 품질 기준을 통과하지 못했습니다. 아래 피드백을 참고하여 개선된 전략을 수립하세요:
${previousFeedback}`;
  }

  dynamicPrompt += `

IMPORTANT: You may ONLY route to agents listed above. If no agents are available, classify as "simple".`;

  const classifier = mastra.getAgent("classifierAgent");
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
}
