import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";
import {
  mcpConnectionManager,
  MCP_REGISTRY,
  getAllMcpIds,
  getRegistryEntry,
} from "../../mcp";
import { workflowStateSchema } from "../state";

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
const QUALITY_THRESHOLD = 0.9;

// ─── Suggestion Schema ───

const suggestionSchema = z.object({
  id: z.string().describe("고유 제안 ID (예: suggest-1)"),
  description: z
    .string()
    .describe("사용자에게 표시할 개선 방법 설명 (한국어, 1문장)"),
  actionType: z
    .enum(["refine", "reroute"])
    .describe("refine = 같은 Agent 재시도, reroute = 다른 Agent"),
  refinedQuery: z
    .string()
    .optional()
    .describe("refine 시 사용할 개선된 검색어"),
  targetAgent: z
    .string()
    .optional()
    .describe("reroute 시 대상 Agent ID"),
});

type Suggestion = z.infer<typeof suggestionSchema>;

// ─── Suspend / Resume Schemas ───

const suspendPayloadSchema = z.object({
  reason: z.string().describe("suspend 사유"),
  score: z.number().describe("품질 점수 (0-1)"),
  originalSource: z.string().describe("결과 출처 Agent"),
  originalQuery: z.string().describe("사용자의 원본 질문"),
  suggestions: z
    .array(suggestionSchema)
    .describe("AI가 생성한 개선 제안 (2-3개)"),
  availableAgents: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .describe("reroute 가능한 Agent 목록"),
});

const resumeDataSchema = z.object({
  action: z
    .enum(["refine", "reroute", "new", "dismiss", "suggestion"])
    .describe("사용자 선택 액션"),
  suggestionId: z.string().optional().describe("클릭한 제안 ID"),
  userFeedback: z.string().optional().describe("사용자 추가 지시"),
  targetAgent: z
    .string()
    .optional()
    .describe("reroute/suggestion 시 대상 Agent ID"),
  refinedQuery: z
    .string()
    .optional()
    .describe("suggestion 시 개선된 검색어"),
});

// ─── Suggestion 생성 (Haiku LLM) ───

/**
 * AI가 낮은 품질의 결과를 분석하고 2-3개의 구체적 개선 제안을 생성한다.
 * finalResponserAgent(Haiku)를 재사용하여 비용 절감.
 */
async function generateSuggestions(params: {
  userMessage: string;
  agentResult: string;
  source: string;
  score: number;
  availableAgents: Array<{ value: string; label: string }>;
  mastra: any;
  executionTargets: string[];
  executionMode: string;
  userId: string;
  threadId: string;
}): Promise<Suggestion[]> {
  const {
    userMessage,
    agentResult,
    source,
    score,
    availableAgents,
    mastra,
    executionTargets,
    executionMode,
    userId,
    threadId,
  } = params;

  try {
    const agent = mastra.getAgent("finalResponserAgent");

    const availableAgentList =
      availableAgents.length > 0
        ? availableAgents
            .map((a) => `- "${a.value}": ${a.label}`)
            .join("\n")
        : "(없음)";

    // 실행 파이프라인 설명 생성
    const pipelineDesc =
      executionTargets.length > 1
        ? `${executionTargets.map((t) => {
            const entry = getRegistryEntry(t);
            return entry ? `"${t}" (${entry.name})` : `"${t}"`;
          }).join(" → ")} [${executionMode} 모드]`
        : executionTargets.length === 1
          ? `"${executionTargets[0]}" (${getRegistryEntry(executionTargets[0])?.name || executionTargets[0]})`
          : `"${source}"`;

    const prompt = `Agent 실행 결과의 품질이 낮습니다. 결과를 분석하고 구체적인 개선 방법을 2-3개 제안해주세요.

## 맥락
- 사용자 질문: "${userMessage}"
- 실행 파이프라인: ${pipelineDesc}
- 품질 점수: ${score.toFixed(2)} / 1.00
- 실행 결과 (일부):
${agentResult.slice(0, 800)}

## 대안 Agent 목록
${availableAgentList}

## 분석 방법
먼저 결과에서 실패 원인을 파악하세요:
- Agent가 관련 데이터를 찾지 못했는가? (검색 키워드 문제)
- 잘못된 테이블/컬럼을 참조했는가? (hallucination 문제)
- 쿼리는 생성했지만 실행에 실패했는가? (SQL 오류)
- 결과가 사용자 질문과 관련 없는가? (라우팅 문제)

## 규칙
- 정확히 2-3개의 제안을 생성하세요.
- 각 제안은 다음 중 하나:
  1. "refine" — 같은 Agent 파이프라인에 개선된 지시로 재시도
     - refinedQuery: 구체적인 개선 지시문을 작성하세요 (예: "template 키워드 대신 'tmpl' 또는 '템플릿'으로 검색", "status 컬럼으로 is_active = true 필터링")
     - 단순히 "더 자세히 검색" 같은 모호한 지시가 아니라, 결과에서 발견한 문제를 해결하는 구체적 지시를 제시하세요
  2. "reroute" — 다른 Agent로 전환 (targetAgent에 위 목록의 Agent ID 필수, 목록이 없으면 reroute 제안 금지)
- description은 한국어 1-2문장으로, **왜 이 제안이 문제를 해결하는지** 설명하세요
- 각 제안의 id는 "suggest-1", "suggest-2" 등으로 지정하세요.`;

    const suggestionsResponseSchema = z.object({
      suggestions: z.array(suggestionSchema).min(2).max(3),
    });

    const result = await agent.generate(prompt, {
      structuredOutput: { schema: suggestionsResponseSchema },
      memory: {
        resource: userId,
        thread: threadId,
        options: { readOnly: true },
      },
    });

    return (result.object as { suggestions: Suggestion[] }).suggestions;
  } catch (error) {
    console.warn(
      "[quality-check] Suggestion 생성 실패, fallback 사용:",
      error,
    );
    // Fallback: 범용 refine + 대안 Agent reroute
    return [
      {
        id: "suggest-fallback-1",
        description: `"${userMessage}" 검색어를 다른 키워드로 다시 검색합니다.`,
        actionType: "refine" as const,
        refinedQuery: userMessage,
      },
      ...(availableAgents.length > 0
        ? [
            {
              id: "suggest-fallback-2",
              description: `${availableAgents[0].label}에서 검색을 시도합니다.`,
              actionType: "reroute" as const,
              targetAgent: availableAgents[0].value,
            },
          ]
        : []),
    ];
  }
}

// ─── Suspend Payload 빌더 ───

/** suspend payload 생성 — AI 제안 포함, 활성 MCP만 대상 */
async function buildSuspendPayload(
  reason: string,
  score: number,
  originalSource: string,
  originalQuery: string,
  activeMcpIds: string[],
  mastra: any,
  agentResult: string,
  executionTargets: string[],
  executionMode: string,
  userId: string,
  threadId: string,
) {
  const availableAgents = MCP_REGISTRY.filter(
    (entry) =>
      entry.id !== originalSource && activeMcpIds.includes(entry.id),
  ).map((entry) => ({ value: entry.id, label: entry.name }));

  const suggestions = await generateSuggestions({
    userMessage: originalQuery,
    agentResult,
    source: originalSource,
    score,
    availableAgents,
    mastra,
    executionTargets,
    executionMode,
    userId,
    threadId,
  });

  return {
    reason,
    score,
    originalSource,
    originalQuery,
    suggestions,
    availableAgents,
  };
}

// ─── Agent 호출 헬퍼 ───

/** Registry에서 Agent를 찾아 호출하는 공통 로직 */
async function callAgent(
  mcpIdOrSource: string,
  prompt: string,
  mastra: any,
): Promise<{ source: string; content: string; success: boolean }> {
  const entry = getRegistryEntry(mcpIdOrSource);
  const agentId = entry?.agentId;
  if (!agentId) {
    return { source: mcpIdOrSource, content: prompt, success: true };
  }

  try {
    const agent = mastra.getAgent(agentId);
    const mcpId = entry?.mcpId || mcpIdOrSource;
    const toolsets = await mcpConnectionManager.getToolsets(mcpId);
    const result = await agent.generate(prompt, { toolsets });
    return { source: mcpIdOrSource, content: result.text, success: true };
  } catch (error) {
    return {
      source: mcpIdOrSource,
      content: `재실행 오류: ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }
}

// ─── Quality Check Step ───

/**
 * Quality Check Step
 *
 * Agent 실행 결과의 품질을 평가하고, 낮으면 AI 제안과 함께 suspend한다.
 *
 * 1. 규칙 기반 체크: success === false 또는 빈 content → 즉시 suspend
 * 2. 품질 점수: 길이, 키워드 커버리지, 구조적 품질 → score < threshold → suspend
 * 3. Suspend 시: Haiku가 2-3개의 구체적 개선 제안 생성
 * 4. Resume 시:
 *    - suggestion: AI 제안 클릭 → 제안의 refine/reroute 파라미터로 재실행
 *    - refine: 같은 Agent + 원본 질문 + 사용자 피드백으로 재실행
 *    - reroute: targetAgent + 원본 질문 + 사용자 피드백으로 재실행
 *    - dismiss: bail()로 워크플로우 종료
 *    - new: /chat 라우트에서 새 workflow로 처리 (여기서는 도달하지 않음)
 */
export const qualityCheckStep = createStep({
  id: "quality-check",
  inputSchema: agentResultSchema,
  outputSchema: agentResultSchema,
  resumeSchema: resumeDataSchema,
  suspendSchema: suspendPayloadSchema,
  stateSchema: workflowStateSchema,
  execute: async ({
    inputData,
    resumeData,
    suspend,
    bail,
    mastra,
    getInitData,
    requestContext,
    state,
  }) => {
    const initData = getInitData<{ message: string }>();
    const originalMessage = initData?.message || "";
    const activeMcpIds =
      (requestContext?.get("activeMcpIds") as string[] | undefined) ||
      getAllMcpIds();
    const executionTargets = state?.executionTargets || [];
    const executionMode = state?.executionMode || "parallel";
    const userId =
      (requestContext?.get("userId") as string | undefined) || "default-user";
    const threadId =
      (requestContext?.get("threadId") as string | undefined) ||
      "default-thread";

    // === Resume 경로 ===
    if (resumeData?.action) {
      const feedback = resumeData.userFeedback || "";

      // --- Dismiss: bail()로 워크플로우 종료 ---
      if (resumeData.action === "dismiss") {
        return bail({
          source: inputData.source,
          content: "사용자가 워크플로우를 종료했습니다.",
          success: true,
        });
      }

      // --- Suggestion: AI 제안 클릭 → 제안 파라미터로 재실행 ---
      if (resumeData.action === "suggestion") {
        if (resumeData.targetAgent) {
          // reroute suggestion
          const prompt = feedback
            ? `${originalMessage}\n\n추가 지시: ${feedback}`
            : originalMessage;
          return await callAgent(resumeData.targetAgent, prompt, mastra);
        } else {
          // refine suggestion
          const queryToUse = resumeData.refinedQuery || originalMessage;
          const prompt = feedback
            ? `${queryToUse}\n\n추가 지시: ${feedback}`
            : queryToUse;
          return await callAgent(inputData.source, prompt, mastra);
        }
      }

      // --- Refine: 같은 Agent + 원본 질문 + 피드백 ---
      if (resumeData.action === "refine") {
        const prompt = originalMessage
          ? `원본 질문: ${originalMessage}\n\n추가 지시: ${feedback}`
          : feedback;
        return await callAgent(inputData.source, prompt, mastra);
      }

      // --- Reroute: 다른 Agent로 전환 ---
      if (resumeData.action === "reroute" && resumeData.targetAgent) {
        const prompt = feedback
          ? `${originalMessage}\n\n추가 지시: ${feedback}`
          : originalMessage;
        return await callAgent(resumeData.targetAgent, prompt, mastra);
      }

      // action === "new"는 여기 도달하지 않음 (/chat 라우트에서 새 workflow 시작)
      return {
        source: inputData.source,
        content: feedback || inputData.content,
        success: true,
      };
    }

    // === 규칙 기반 체크 ===
    if (!inputData.success || inputData.content.trim().length === 0) {
      return await suspend(
        await buildSuspendPayload(
          "Agent 실행이 실패했거나 결과가 비어있습니다.",
          0,
          inputData.source,
          originalMessage,
          activeMcpIds,
          mastra,
          inputData.content,
          executionTargets,
          executionMode,
          userId,
          threadId,
        ),
      );
    }

    // === direct 응답은 품질 체크 스킵 (인사말 등 단순 응답) ===
    if (inputData.source === "direct") {
      return inputData;
    }

    // === 품질 점수 평가 ===
    const score = computeQualityScore(inputData.content, originalMessage);

    if (score < QUALITY_THRESHOLD) {
      return await suspend(
        await buildSuspendPayload(
          `결과 품질이 낮습니다 (score: ${score.toFixed(2)}).`,
          score,
          inputData.source,
          originalMessage,
          activeMcpIds,
          mastra,
          inputData.content,
          executionTargets,
          executionMode,
          userId,
          threadId,
        ),
      );
    }

    // === 통과 ===
    return inputData;
  },
});
