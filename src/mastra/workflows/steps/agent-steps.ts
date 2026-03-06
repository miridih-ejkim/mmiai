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
  confidence: z.number().optional().nullable().describe("Worker Agent 자기 확신도 (0.0-1.0)"),
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
 * Raw JSON Schema for worker structuredOutput.
 * Zod v4 → JSON Schema 변환 우회용 (Claude constrained decoding 호환).
 */
const workerOutputJsonSchema: import("json-schema").JSONSchema7 = {
  type: "object",
  properties: {
    content: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["content", "confidence"],
  additionalProperties: false,
};

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
    // dountil 2차+ iteration에서는 initData.message가 없으므로 state에서 복원
    const userMessage = initData?.message || state?.originalMessage || "";
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
    // queries를 plain {agentId, query} 배열로 정규화하여 기록
    const flatQueries = activeTargets.map((t) => {
      const entry = inputData.queries.find((q) => q.agentId === t);
      return { agentId: t, query: entry?.query || userMessage };
    });
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
        let hasSuccessfulResult = false;

        for (const target of activeTargets) {
          const entry = getRegistryEntry(target);
          if (!entry) continue;

          const agent = mastra!.getAgent(entry.agentId);
          const mcpId = entry.mcpId || target;
          const toolsets = await mcpConnectionManager.getToolsets(mcpId);

          // MCP 도구가 없으면 즉시 실패 (도구 없이 Agent 실행 방지)
          const toolCount = Object.values(toolsets).reduce(
            (sum, ts) => sum + Object.keys(ts).length, 0,
          );
          if (toolCount === 0) {
            const msg = `[${entry.name}] MCP 서버에 연결할 수 없거나 도구를 로드하지 못했습니다. 환경변수(MCP 서버 URL)를 확인하세요.`;
            allResults.push(msg);
            continue;
          }

          // queries 배열에서 해당 agent의 쿼리 항목 조회
          const queryEntry = inputData.queries.find((q) => q.agentId === target);
          const queryPlan: SequentialQuery = queryEntry
            ? { query: queryEntry.query, goal: queryEntry.goal || "", contextHint: queryEntry.contextHint }
            : { query: userMessage, goal: "" };

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

          console.log(`[agent-step] Calling ${entry.name} (${mcpId}) with ${toolCount} tools`);

          let output: z.infer<typeof workerOutputSchema>;
          try {
            const result = await agent.generate(prompt, {
              maxSteps: 10,
              toolsets,
              structuredOutput: {
                schema: workerOutputJsonSchema,
                model: "anthropic/claude-haiku-4-5",
              },
            });
            output = result.object as z.infer<typeof workerOutputSchema>;
          } catch (genErr: any) {
            // Worker Agent도 $PARAMETER_NAME 래핑 에러 발생 가능
            if (genErr?.details?.value) {
              try {
                const raw = typeof genErr.details.value === "string"
                  ? JSON.parse(genErr.details.value)
                  : genErr.details.value;
                const unwrapped = raw["$PARAMETER_NAME"] || raw;
                const parsed = workerOutputSchema.parse(unwrapped);
                console.warn(`[agent-step] ${entry.name}: Recovered from structured output error`);
                output = parsed;
              } catch {
                console.error(`[agent-step] ${entry.name}: Failed to recover from structured output error:`, genErr.message);
                allResults.push(`[${entry.name}] 응답 파싱 오류: ${genErr.message}`);
                continue;
              }
            } else {
              console.error(`[agent-step] ${entry.name}: generate() error:`, genErr.message);
              allResults.push(`[${entry.name}] 오류: ${genErr.message}`);
              continue;
            }
          }

          const safeConfidence = Number.isFinite(output.confidence) ? output.confidence : undefined;
          console.log(`[agent-step] ${entry.name} result: confidence=${safeConfidence}, content length=${output.content.length}`);
          previousResult = output.content;
          allResults.push(
            activeTargets.length === 1
              ? output.content
              : `[${entry.name}]\n${output.content}`,
          );
          lastConfidence = safeConfidence;
          hasSuccessfulResult = true;
        }

        const merged = allResults.join("\n\n---\n\n");
        return {
          source: sourceLabel,
          content: merged || "결과를 생성하지 못했습니다.",
          success: hasSuccessfulResult,
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

              // MCP 도구가 없으면 즉시 실패 (도구 없이 Agent 실행 방지)
              const toolCount = Object.values(toolsets).reduce(
                (sum, ts) => sum + Object.keys(ts as Record<string, unknown>).length, 0,
              );
              if (toolCount === 0) {
                return `[${entry.name}] MCP 서버에 연결할 수 없거나 도구를 로드하지 못했습니다.`;
              }

              const queryEntry = inputData.queries.find((q) => q.agentId === target);
              const query = queryEntry?.query || userMessage;
              let output: z.infer<typeof workerOutputSchema>;
              try {
                const result = await agent.generate(query, {
                  maxSteps: 10,
                  toolsets,
                  structuredOutput: {
                    schema: workerOutputJsonSchema,
                    model: "anthropic/claude-haiku-4-5",
                  },
                });
                output = result.object as z.infer<typeof workerOutputSchema>;
              } catch (genErr: any) {
                // $PARAMETER_NAME 래핑 에러 복구
                if (genErr?.details?.value) {
                  const raw = typeof genErr.details.value === "string"
                    ? JSON.parse(genErr.details.value)
                    : genErr.details.value;
                  const unwrapped = raw["$PARAMETER_NAME"] || raw;
                  output = workerOutputSchema.parse(unwrapped);
                  console.warn(`[agent-step] ${entry.name}: Recovered from structured output error (parallel)`);
                } else {
                  throw genErr;
                }
              }
              if (Number.isFinite(output.confidence)) {
                confidences.push(output.confidence);
              }
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
