import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { MCP_REGISTRY, getAllMcpIds } from "../../mcp";
import { workflowStateSchema, type RetryEntry } from "../state";

/**
 * Sequential 모드에서 각 단계의 구조화된 쿼리
 * goal과 contextHint로 단계 간 맥락 전달을 강화
 */
const sequentialQuerySchema = z.object({
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
    .array(
      z.object({
        agentId: z.string(),
        query: z.string(),
        goal: z.string().optional(),
        contextHint: z.string().optional(),
      }),
    )
    .describe(
      "각 agent에게 전달할 쿼리 배열. agentId로 대상 지정, sequential이면 goal/contextHint 포함",
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

/**
 * Raw JSON Schema for classifier structuredOutput.
 * Zod v4 → JSON Schema 변환이 additionalProperties 규칙을 위반하므로
 * Claude native constrained decoding 호환을 위해 직접 정의합니다.
 */
const classificationJsonSchema: import("json-schema").JSONSchema7 = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["simple", "agent", "clarify", "ambiguous"] },
    targets: { type: "array", items: { type: "string" } },
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          query: { type: "string" },
          goal: { type: "string" },
          contextHint: { type: "string" },
        },
        required: ["agentId", "query"],
        additionalProperties: false,
      },
    },
    reasoning: { type: "string" },
    executionMode: { type: "string", enum: ["parallel", "sequential"] },
    clarifyQuestion: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          planId: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          targets: { type: "array", items: { type: "string" } },
          executionMode: { type: "string", enum: ["parallel", "sequential"] },
          expectedOutcome: { type: "string" },
        },
        required: ["planId", "label", "description", "targets", "expectedOutcome"],
        additionalProperties: false,
      },
    },
  },
  required: ["type", "targets", "queries", "reasoning"],
  additionalProperties: false,
};

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
      queries: [],
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
    setState,
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
    // dountil 2차+ iteration에서는 inputData.message가 없으므로 state에서 복원
    const originalMessage =
      initData?.message || inputData.message || state?.originalMessage || "";

    // 원본 메시지를 state에 저장 (첫 iteration에서만 실제 저장됨)
    if (originalMessage && !state?.originalMessage) {
      await setState({ ...state, originalMessage });
    }

    // === Resume 경로 ===
    if (resumeData) {
      // clarify: 사용자 답변 → state.clarifyAnswer에 구조화 저장 후 재분류
      if (resumeData.userAnswer) {
        // clarify 답변을 workflow state에 구조화된 필드로 저장
        // originalMessage는 변경하지 않음 — 원본 질문 보존
        await setState({ ...state, clarifyAnswer: resumeData.userAnswer });

        return await classifyMessage({
          message: originalMessage,
          activeMcpIds,
          userId,
          threadId,
          mastra: mastra!,
          previousFeedback: undefined,
          retryHistory: [],
          clarifyAnswer: resumeData.userAnswer,
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
            retryHistory: [],
          });
        }

        const queries = targets.map(t => ({ agentId: t, query: originalMessage }));

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
    const retryHistory = state?.retryHistory ?? [];

    const classification = await classifyMessage({
      message: originalMessage,
      activeMcpIds,
      userId,
      threadId,
      mastra: mastra!,
      previousFeedback,
      retryHistory,
      clarifyAnswer: state?.clarifyAnswer,
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
  retryHistory: RetryEntry[];
  clarifyAnswer?: string;
}): Promise<ClassificationOutput> {
  const {
    message,
    activeMcpIds,
    userId,
    threadId,
    mastra,
    previousFeedback,
    retryHistory,
    clarifyAnswer,
  } = params;

  // 활성 MCP만 포함한 동적 시스템 컨텍스트 구성
  // system 옵션으로 전달하여 Memory에 role=user로 저장되는 것을 방지
  const activeAgentDescriptions = MCP_REGISTRY.filter((entry) =>
    activeMcpIds.includes(entry.id),
  )
    .map((entry) => `- "${entry.id}": ${entry.description}`)
    .join("\n");

  let systemContext = `[AVAILABLE AGENTS]
${activeAgentDescriptions || "(none — classify as simple)"}`;

  // 재시도 이력이 있으면 전체 이력 주입
  if (retryHistory.length > 0) {
    const historyLines = retryHistory.map((entry) => {
      const querySummary = (entry.queries ?? [])
        .map((q) => `${q.agentId}="${q.query}"`)
        .join(", ");
      return `- Attempt ${entry.attempt}: targets=[${entry.targets.join(", ")}] queries={${querySummary}} mode=${entry.executionMode} reason="${entry.reason}"${entry.confidence != null ? ` confidence=${entry.confidence.toFixed(2)}` : ""}`;
    }).join("\n");

    systemContext += `

[RETRY HISTORY]
이전 ${retryHistory.length}회 시도의 품질이 부족했습니다. 각 시도의 피드백을 참고하여 개선하세요:
${historyLines}

${previousFeedback ? `최신 피드백:\n${previousFeedback}\n` : ""}같은 Agent를 다시 사용해도 좋지만, 피드백에서 지적된 부족한 부분을 보완할 수 있도록 쿼리나 접근 방식을 조정하세요.`;
  } else if (previousFeedback) {
    systemContext += `

[PREVIOUS FEEDBACK]
이전 실행 결과의 품질이 부족했습니다. 아래 피드백을 참고하여 부족한 부분을 보완하세요:
${previousFeedback}`;
  }

  // clarify resume 후 재분류: 사용자가 제공한 추가 정보를 구조화된 컨텍스트로 주입
  if (clarifyAnswer) {
    systemContext += `

[CLARIFY ANSWER]
사용자가 이전 clarify 질문에 대해 제공한 추가 정보입니다:
"${clarifyAnswer}"

이 정보는 사용자가 명시적으로 제공한 것이므로 반드시 반영하세요:
- 이 정보를 원본 질문과 결합하여 완전한 쿼리를 구성하세요 (예: "날씨 알려줘" + "타이페이" → query: "타이페이 날씨")
- 이미 제공된 정보에 대해 다시 clarify하지 마세요
- 반드시 "agent" 타입으로 분류하고 적절한 Agent에게 전달하세요`;
  }

  systemContext += `

IMPORTANT: You may ONLY route to agents listed above. If no agents are available, classify as "simple".`;

  const classifier = mastra.getAgent("classifierAgent");

  let classification: ClassificationOutput;
  try {
    const result = await classifier.generate(message, {
      system: systemContext,
      memory: {
        resource: userId,
        thread: threadId,
      },
      structuredOutput: {
        schema: classificationJsonSchema,
      },
    });
    classification = result.object as ClassificationOutput;
  } catch (err: any) {
    // Mastra structured output 검증 실패 시 복구 시도
    // 발생 케이스:
    // 1) LLM이 { "$PARAMETER_NAME": { 실제_데이터 } } 형태로 응답
    // 2) LLM이 불완전한 JSON 반환 (일부 필드 undefined)
    // 3) 기타 structured output 검증 실패
    const isStructuredOutputError =
      err?.id === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED" ||
      err?.details?.value != null;

    if (isStructuredOutputError) {
      try {
        const raw = err.details?.value
          ? (typeof err.details.value === "string"
              ? JSON.parse(err.details.value)
              : err.details.value)
          : null;

        if (raw) {
          // $PARAMETER_NAME wrapper 제거 후 파싱 시도
          const unwrapped = raw["$PARAMETER_NAME"] || raw;
          const parsed = classificationOutputSchema.parse(unwrapped);
          console.warn("[classify-intent] Recovered from structured output validation failure");
          classification = parsed;
        } else {
          throw new Error("No recoverable value in error details");
        }
      } catch {
        // 복구 실패 → simple로 fallback (워크플로우 중단 방지)
        console.error("[classify-intent] Failed to recover from structured output error:", err.message);
        classification = {
          type: "simple",
          targets: [],
          queries: [],
          reasoning: `분류 실패 (${err.message}). 직접 응답으로 전환합니다.`,
          executionMode: "parallel",
        };
      }
    } else {
      // structured output이 아닌 다른 오류도 simple fallback으로 처리
      // 워크플로우 전체가 실패하는 것보다 simple 응답이 나은 UX
      console.error("[classify-intent] Unexpected error, falling back to simple:", err.message);
      classification = {
        type: "simple",
        targets: [],
        queries: [],
        reasoning: `분류 중 오류 발생 (${err?.message || "unknown"}). 직접 응답으로 전환합니다.`,
        executionMode: "parallel",
      };
    }
  }

  // 후처리: type/필드 불일치 교정 + 비활성 MCP 필터링
  // LLM이 clarifyQuestion을 생성했지만 type을 "simple"로 잘못 설정한 경우 교정
  if (classification.type !== "clarify" && classification.clarifyQuestion) {
    console.warn(
      `[classify-intent] Type mismatch: type="${classification.type}" but clarifyQuestion present. Correcting to "clarify".`,
    );
    classification = {
      ...classification,
      type: "clarify",
      targets: [],
      queries: [],
    };
  }
  // LLM이 candidates를 생성했지만 type을 "ambiguous"로 설정하지 않은 경우 교정
  if (
    classification.type !== "ambiguous" &&
    classification.candidates &&
    classification.candidates.length > 0
  ) {
    console.warn(
      `[classify-intent] Type mismatch: type="${classification.type}" but candidates present. Correcting to "ambiguous".`,
    );
    classification = {
      ...classification,
      type: "ambiguous",
      targets: [],
      queries: [],
    };
  }
  return validateClassification(classification, activeMcpIds);
}
