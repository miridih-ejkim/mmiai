// top-level await (ESM)
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { registerApiRoute } from "@mastra/core/server";

import {
  mcpConnectionManager,
  MCP_REGISTRY,
  getUserActiveMcpIds,
  setUserMcpActivation,
  getUserMcpStatuses,
} from "./mcp";
import {
  createAtlassianAgent,
  createGoogleSearchAgent,
  createDataHubAgent,
  createDataAnalystAgent,
} from "./agents/workers";
import {
  createClassifierAgent,
  conversationMemoryOptions,
} from "./agents/classifier-agent";
import { createFinalResponserAgent } from "./agents/final-responser";

import { chatWorkflow } from "./workflows/chat-workflow";

/**
 * Mastra 인스턴스 비동기 초기화
 *
 * Lazy MCP Loading + Deterministic Workflow + HITL 구조:
 * - Worker Agent를 도구 없이 생성 (도구는 요청 시점에 lazy 주입)
 * - RequestContext로 userId, activeMcpIds를 워크플로우에 전달
 * - classify-intent가 활성 MCP만 대상으로 분류
 * - agent-step에서 MCPConnectionManager.getToolsets()로 동적 toolsets 주입
 */
export async function initializeMastra(): Promise<{
  mastra: Mastra;
  shutdown: () => Promise<void>;
}> {
  // Worker Agents 생성 (도구 없이 — 요청 시점에 lazy toolsets 주입)
  const atlassianAgent = createAtlassianAgent();
  const googleSearchAgent = createGoogleSearchAgent();
  const dataHubAgent = createDataHubAgent();
  const dataAnalystAgent = createDataAnalystAgent();

  // 공유 Memory 인스턴스 — classifier와 finalResponser가 같은 스레드에 읽기/쓰기
  // finalResponser가 응답을 기록하고, classifier가 대화 맥락을 recall
  const conversationMemory = new Memory({
    options: {
      lastMessages: 20,
      ...conversationMemoryOptions,
    },
  });

  // Classifier Agent 생성 (의도 분류 전용, 공유 Memory로 대화 맥락 recall)
  const classifierAgent = createClassifierAgent(conversationMemory);

  // Final Responser Agent 생성 (응답 합성 전용, 공유 Memory에 응답 기록)
  const finalResponserAgent = createFinalResponserAgent(conversationMemory);

  // Mastra 인스턴스 생성
  const mastra = new Mastra({
    agents: {
      classifierAgent,
      finalResponserAgent,
      atlassianAgent,
      googleSearchAgent,
      dataHubAgent,
      dataAnalystAgent,
    },
    workflows: {
      chatWorkflow,
    },
    storage: new PostgresStore({
      id: "mastra",
      connectionString: process.env.DATABASE_URL,
    }),
    logger: new PinoLogger({
      name: "Mastra",
      level: "info",
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: "mastra",
          exporters: [new DefaultExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    }),
    server: {
      apiRoutes: [
        // Chat Workflow (suspend/resume 지원 커스텀 라우트)
        registerApiRoute("/chat", {
          method: "POST",
          handler: async (c) => {
            try {
              const body = await c.req.json();
              const workflow = mastra.getWorkflow("chatWorkflow");

              // 사용자별 활성 MCP 조회
              const userId = body.userId || "default-user";
              const threadId =
                body.threadId ||
                `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const activeMcpIds = await getUserActiveMcpIds(userId);

              // RequestContext 생성
              const requestContext = new RequestContext();
              requestContext.set("userId", userId);
              requestContext.set("threadId", threadId);
              requestContext.set("activeMcpIds", activeMcpIds);

              let result: any;

              if (body.runId && body.resumeData) {
                const action = body.resumeData.action;

                if (action === "new") {
                  // === New: 사용자의 새 질문으로 새 워크플로우 시작 ===
                  const run = await workflow.createRun();
                  result = await run.start({
                    inputData: {
                      message: body.resumeData.userFeedback || "",
                    },
                    requestContext,
                  });
                } else {
                  // === Refine / Reroute: suspend된 워크플로우 재개 ===
                  const run = await workflow.createRun({
                    runId: body.runId,
                  });
                  result = await run.resume({
                    step: "quality-check",
                    resumeData: body.resumeData,
                    requestContext,
                  });
                }
              } else {
                // === New: 새 워크플로우 실행 ===
                const run = await workflow.createRun();
                result = await run.start({
                  inputData: body.inputData || {
                    message: body.message || "",
                  },
                  requestContext,
                });
              }

              // Suspended → AI 제안 포함 응답
              if (result.status === "suspended") {
                const suspendPayload =
                  result.steps?.["quality-check"]?.suspendPayload as
                    | {
                        reason?: string;
                        score?: number;
                        originalSource?: string;
                        originalQuery?: string;
                        suggestions?: Array<{
                          id: string;
                          description: string;
                          actionType: string;
                          refinedQuery?: string;
                          targetAgent?: string;
                        }>;
                        availableAgents?: Array<{
                          value: string;
                          label: string;
                        }>;
                      }
                    | undefined;
                return c.json({
                  status: "suspended",
                  runId: result.runId,
                  reason: suspendPayload?.reason || "품질 검증 실패",
                  score: suspendPayload?.score ?? 0,
                  originalSource:
                    suspendPayload?.originalSource || "unknown",
                  originalQuery: suspendPayload?.originalQuery || "",
                  suggestions: suspendPayload?.suggestions || [],
                  availableAgents: suspendPayload?.availableAgents || [],
                });
              }

              // Completed — 응답은 finalResponser의 공유 Memory에 자동 기록됨
              const responseText =
                result.result?.response ||
                "워크플로우가 종료되었습니다.";

              return c.json({
                status: "completed",
                response: responseText,
              });
            } catch (error) {
              console.error("[/chat] Error:", error);
              return c.json(
                {
                  status: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Internal server error",
                },
                500,
              );
            }
          },
        }),
        // 대화 기록 조회 (향후 메모리 통합 예정)
        registerApiRoute("/chat-history", {
          method: "GET",
          handler: async (c) => {
            return c.json([]);
          },
        }),
        // MCP 레지스트리 조회 (관리자 승인 MCP 목록)
        registerApiRoute("/mcp/registry", {
          method: "GET",
          handler: async (c) => {
            return c.json(
              MCP_REGISTRY.map((entry) => ({
                id: entry.id,
                name: entry.name,
                description: entry.description,
              })),
            );
          },
        }),
        // 사용자별 MCP 활성화 상태 조회
        registerApiRoute("/mcp/activations", {
          method: "GET",
          handler: async (c) => {
            const userId =
              c.req.query("userId") || "default-user";
            const statuses = await getUserMcpStatuses(userId);
            return c.json(statuses);
          },
        }),
        // 사용자별 MCP 활성화 토글
        registerApiRoute("/mcp/activations", {
          method: "POST",
          handler: async (c) => {
            const body = await c.req.json();
            const { userId, mcpId, active } = body;
            if (!userId || !mcpId || active === undefined) {
              return c.json(
                { error: "userId, mcpId, active are required" },
                400,
              );
            }
            await setUserMcpActivation(userId, mcpId, active);
            return c.json({ success: true });
          },
        }),
      ],
    },
  });

  return {
    mastra,
    shutdown: () => mcpConnectionManager.disconnectAll(),
  };
}

const { mastra, shutdown } = await initializeMastra();

export { mastra, shutdown };
