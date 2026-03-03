import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { classificationOutputSchema, type SequentialQuery } from "./classify-intent";
import { mcpConnectionManager, getRegistryEntry, getAllMcpIds } from "../../mcp";
import { workflowStateSchema } from "../state";

/**
 * Agent 실행 결과 스키마
 * 모든 경로(direct, agent)에서 동일한 형태로 반환
 * .branch()의 모든 분기가 동일한 outputSchema를 가져야 하므로 공유
 */
export const agentResultSchema = z.object({
  source: z
    .string()
    .describe(
      "결과 출처 (direct, multi-agent, 또는 MCP ID)",
    ),
  content: z.string().describe("Agent 실행 결과 텍스트"),
  success: z.boolean().describe("실행 성공 여부"),
  confidence: z.number().optional().describe("Worker Agent 자기 확신도 (0.0-1.0)"),
});

export type AgentResult = z.infer<typeof agentResultSchema>;

/**
 * Worker Agent structuredOutput 스키마
 * agent.generate()에 전달하여 LLM이 반드시 이 형태로 응답하도록 강제
 */
const workerOutputSchema = z.object({
  content: z.string().describe("사용자에게 전달할 응답 본문"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "이 응답이 사용자 질문에 정확히 답하는지에 대한 확신도 (0.0 = 전혀 답이 안 됨, 1.0 = 완벽히 답함)",
    ),
});

/**
 * Direct Response Step (simple 분기)
 * Agent 호출 없이 Classifier의 reasoning을 직접 전달
 */
export const directResponseStep = createStep({
  id: "direct-response",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData }) => {
    return {
      source: "direct",
      content: inputData.reasoning,
      success: true,
    };
  },
});

/**
 * Agent Step (agent 분기 — 통합)
 *
 * targets 기반으로 1개 또는 N개의 Worker Agent를 동적으로 호출합니다.
 * - targets 1개: single agent 호출, source = 해당 MCP ID
 * - targets 2개+: executionMode에 따라 병렬/순차 호출, source = "multi-agent"
 *
 * Registry에 MCP가 추가되면 별도 Step/branch 수정 없이 자동 확장됩니다.
 */
export const agentStep = createStep({
  id: "agent-step",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, mastra, getInitData, requestContext, state, setState }) => {
    const initData = getInitData<{ message: string }>();
    const userMessage = initData?.message || "";
    const activeMcpIds =
      (requestContext?.get("activeMcpIds") as string[] | undefined) ||
      getAllMcpIds();

    // 활성 MCP만 필터링
    const activeTargets = inputData.targets.filter((t) =>
      activeMcpIds.includes(t),
    );

    if (activeTargets.length === 0) {
      return {
        source: "agent",
        content: "활성화된 대상 Agent가 없습니다.",
        success: false,
      };
    }

    // source: 1개면 해당 MCP ID, 2개+면 "multi-agent"
    const sourceLabel =
      activeTargets.length === 1 ? activeTargets[0] : "multi-agent";

    // 실행 계획을 workflow state에 기록 → quality-check가 참조
    // queries를 plain string으로 정규화하여 기록
    const flatQueries: Record<string, string> = {};
    for (const t of activeTargets) {
      const raw = inputData.queries[t];
      flatQueries[t] =
        typeof raw === "object" && raw !== null
          ? (raw as SequentialQuery).query
          : (raw as string) || userMessage;
    }
    // 기존 state(retryCount, retryHistory 등)를 보존하면서 targets/mode/queries 업데이트
    await setState({
      ...state,
      executionTargets: activeTargets,
      executionMode: inputData.executionMode || "parallel",
      executionQueries: flatQueries,
    });

    try {
      if (
        activeTargets.length === 1 ||
        inputData.executionMode === "sequential"
      ) {
        // single agent 또는 순차 호출
        // single일 때는 loop 1회로 동일 로직
        let previousResult = "";
        const allResults: string[] = [];
        let lastConfidence: number | undefined;

        for (const target of activeTargets) {
          const entry = getRegistryEntry(target);
          if (!entry) continue;

          const agent = mastra!.getAgent(entry.agentId);
          const mcpId = entry.mcpId || target;
          const toolsets = await mcpConnectionManager.getToolsets(mcpId);

          // queries 값이 string이면 기본 쿼리, object이면 SequentialQuery
          const rawQuery = inputData.queries[target];
          const queryPlan: SequentialQuery =
            typeof rawQuery === "object" && rawQuery !== null
              ? (rawQuery as SequentialQuery)
              : { query: (rawQuery as string) || userMessage, goal: "" };

          let prompt: string;
          if (previousResult && queryPlan.contextHint) {
            // 구조화된 컨텍스트 전달: goal + contextHint로 이전 결과 프레이밍
            prompt = `## 목표\n${queryPlan.goal}\n\n## 이전 단계 결과\n(참고할 정보: ${queryPlan.contextHint})\n${previousResult}\n\n## 요청\n${queryPlan.query}`;
          } else if (previousResult) {
            // contextHint 없이 전체 결과 전달
            prompt = queryPlan.goal
              ? `## 목표\n${queryPlan.goal}\n\n## 이전 단계 결과\n${previousResult}\n\n## 요청\n${queryPlan.query}`
              : `${queryPlan.query}\n\n## 이전 단계 결과\n${previousResult}`;
          } else {
            // 첫 번째 단계
            prompt = queryPlan.goal
              ? `## 목표\n${queryPlan.goal}\n\n## 요청\n${queryPlan.query}`
              : queryPlan.query;
          }

          const result = await agent.generate(prompt, {
            toolsets,
            structuredOutput: { schema: workerOutputSchema },
          });
          const output = result.object as z.infer<typeof workerOutputSchema>;
          previousResult = output.content;
          allResults.push(
            activeTargets.length === 1
              ? output.content
              : `[${entry.name}]\n${output.content}`,
          );
          lastConfidence = output.confidence;
        }

        const merged = allResults.join("\n\n---\n\n");
        return {
          source: sourceLabel,
          content: merged || "결과를 생성하지 못했습니다.",
          success: merged.length > 0,
          confidence: lastConfidence,
        };
      } else {
        // 병렬 호출
        const confidences: number[] = [];
        const results = await Promise.all(
          activeTargets.map(async (target) => {
            const entry = getRegistryEntry(target);
            if (!entry) return null;

            try {
              const agent = mastra!.getAgent(entry.agentId);
              const mcpId = entry.mcpId || target;
              const toolsets =
                await mcpConnectionManager.getToolsets(mcpId);
              const rawQuery = inputData.queries[target];
              const query =
                typeof rawQuery === "object" && rawQuery !== null
                  ? (rawQuery as SequentialQuery).query
                  : (rawQuery as string) || userMessage;
              const result = await agent.generate(query, {
                toolsets,
                structuredOutput: { schema: workerOutputSchema },
              });
              const output = result.object as z.infer<typeof workerOutputSchema>;
              confidences.push(output.confidence);
              return `[${entry.name}]\n${output.content}`;
            } catch (error) {
              return `[${entry.name}]\n오류: ${error instanceof Error ? error.message : String(error)}`;
            }
          }),
        );

        const merged = results.filter(Boolean).join("\n\n---\n\n");
        // 병렬: 가장 낮은 confidence를 채택 (보수적 판단)
        const minConfidence = confidences.length > 0
          ? Math.min(...confidences)
          : undefined;
        return {
          source: sourceLabel,
          content: merged || "결과를 생성하지 못했습니다.",
          success: merged.length > 0,
          confidence: minConfidence,
        };
      }
    } catch (error) {
      return {
        source: sourceLabel,
        content: `Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});
