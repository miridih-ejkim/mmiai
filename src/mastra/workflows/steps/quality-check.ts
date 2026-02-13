import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";
import {
  mcpConnectionManager,
  MCP_REGISTRY,
  getAllMcpIds,
  getRegistryEntry,
} from "../../mcp";

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

/** Quality Check 임계값 (HITL 테스트: 0.95, 운영: 0.3) */
const QUALITY_THRESHOLD = 0.95;

/** suspend 시 사용자에게 제공할 선택지 */
const SUSPEND_OPTIONS = [
  { value: "refine" as const, label: "추가 지시로 보완" },
  { value: "reroute" as const, label: "다른 Agent로 전환" },
  { value: "new" as const, label: "새 질문으로 시작" },
];

/** suspend payload 생성 헬퍼 — 활성 MCP만 포함 */
function buildSuspendPayload(
  reason: string,
  score: number,
  originalSource: string,
  activeMcpIds: string[],
) {
  // 활성 MCP 중 현재 source가 아닌 것만 reroute 대상으로 제공
  const availableAgents = MCP_REGISTRY.filter(
    (entry) =>
      entry.id !== originalSource && activeMcpIds.includes(entry.id),
  ).map((entry) => ({ value: entry.id, label: entry.name }));

  return {
    reason,
    score,
    originalSource,
    options: SUSPEND_OPTIONS,
    availableAgents,
  };
}

/**
 * Quality Check Step
 *
 * Agent 실행 결과의 품질을 평가하고, 낮으면 suspend하여 사용자에게 선택지를 제공한다.
 *
 * 1. 규칙 기반 체크: success === false 또는 빈 content → 즉시 suspend
 * 2. 품질 점수: 길이, 키워드 커버리지, 구조적 품질 → score < threshold → suspend
 * 3. Resume 시:
 *    - refine: 같은 Agent + 원본 질문 + 사용자 피드백으로 재실행 (lazy toolsets 주입)
 *    - reroute: targetAgent + 원본 질문 + 사용자 피드백으로 재실행 (lazy toolsets 주입)
 *    - new: /chat 라우트에서 새 workflow로 처리 (여기서는 도달하지 않음)
 */
export const qualityCheckStep = createStep({
  id: "quality-check",
  inputSchema: agentResultSchema,
  outputSchema: agentResultSchema,
  resumeSchema: z.object({
    action: z.enum(["refine", "reroute", "new"]).describe("사용자 선택 액션"),
    userFeedback: z.string().optional().describe("사용자 추가 지시"),
    targetAgent: z.string().optional().describe("reroute 시 대상 Agent ID"),
  }),
  suspendSchema: z.object({
    reason: z.string().describe("suspend 사유"),
    score: z.number().describe("품질 점수 (0-1)"),
    originalSource: z.string().describe("결과 출처 Agent"),
    options: z
      .array(
        z.object({
          value: z.enum(["refine", "reroute", "new"]),
          label: z.string(),
        }),
      )
      .describe("사용자 선택지"),
    availableAgents: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      )
      .describe("reroute 가능한 Agent 목록"),
  }),
  execute: async ({
    inputData,
    resumeData,
    suspend,
    mastra,
    getInitData,
    requestContext,
  }) => {
    const initData = getInitData<{ message: string }>();
    const originalMessage = initData?.message || "";
    const activeMcpIds =
      (requestContext?.get("activeMcpIds") as string[] | undefined) ||
      getAllMcpIds();

    // === Resume 경로 ===
    if (resumeData?.action) {
      const feedback = resumeData.userFeedback || "";

      if (resumeData.action === "refine") {
        // 같은 Agent + 원본 질문 + 피드백 결합
        const agentId = getRegistryEntry(inputData.source)?.agentId;
        if (agentId) {
          try {
            const agent = mastra!.getAgent(agentId);
            const toolsets = await mcpConnectionManager.getToolsets(
              inputData.source,
            );
            const prompt = originalMessage
              ? `원본 질문: ${originalMessage}\n\n추가 지시: ${feedback}`
              : feedback;
            const result = await agent.generate(prompt, { toolsets });
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
        // direct 또는 unknown source
        return { source: inputData.source, content: feedback, success: true };
      }

      if (resumeData.action === "reroute" && resumeData.targetAgent) {
        // 다른 Agent로 전환
        const agentId = getRegistryEntry(resumeData.targetAgent)?.agentId;
        if (agentId) {
          try {
            const agent = mastra!.getAgent(agentId);
            const toolsets = await mcpConnectionManager.getToolsets(
              resumeData.targetAgent,
            );
            const prompt = feedback
              ? `${originalMessage}\n\n추가 지시: ${feedback}`
              : originalMessage;
            const result = await agent.generate(prompt, { toolsets });
            return {
              source: resumeData.targetAgent,
              content: result.text,
              success: true,
            };
          } catch (error) {
            return {
              source: resumeData.targetAgent,
              content: `재실행 오류: ${error instanceof Error ? error.message : String(error)}`,
              success: false,
            };
          }
        }
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
        buildSuspendPayload(
          "Agent 실행이 실패했거나 결과가 비어있습니다.",
          0,
          inputData.source,
          activeMcpIds,
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
        buildSuspendPayload(
          `결과 품질이 낮습니다 (score: ${score.toFixed(2)}).`,
          score,
          inputData.source,
          activeMcpIds,
        ),
      );
    }

    // === 통과 ===
    return inputData;
  },
});
