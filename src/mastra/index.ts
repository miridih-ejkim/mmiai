// top-level await (ESM)
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { PinoLogger } from "@mastra/loggers";
import { FilteredFileTransport } from "./logger/filtered-file-transport";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { registerApiRoute } from "@mastra/core/server";

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import type { UIMessage } from "ai";

import {
  getChatById,
  createChat,
  saveMessages,
  updateChatTitle,
  updateChatSuspendMeta,
} from "../lib/db/queries";

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
} from "./agents/workers";
import {
  createClassifierAgent,
  conversationMemoryOptions,
} from "./agents/classifier-agent";
import { createFinalResponserAgent } from "./agents/final-responser";

import { chatWorkflow } from "./workflows/chat-workflow";
import {
  a2aSupervisor,
  a2aAtlassian,
  a2aGoogleSearch,
  a2aDataHub,
} from "./a2a/agents";

/** mastra dev/build 시 process.cwd()가 .mastra/ 하위일 수 있으므로 프로젝트 루트를 찾음 */
function resolveProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (!dir.includes("/.mastra/") && existsSync(resolve(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

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
      // Workflow용 Agent
      classifierAgent,
      finalResponserAgent,
      atlassianAgent,
      googleSearchAgent,
      dataHubAgent,
      // A2A 전용 Agent (자연어 소통 가능, MCP tools baked-in)
      a2aAtlassian,
      a2aGoogleSearch,
      a2aDataHub,
      a2aSupervisor,
    },
    workflows: {
      chatWorkflow,
    },
    memory: {
      conversationMemory,
    },
    storage: new PostgresStore({
      id: "mastra",
      connectionString: process.env.DATABASE_URL,
    }),
    logger: new PinoLogger({
      name: "Mastra",
      level: "debug",
      formatters: {
        bindings: () => ({}), // pid, hostname 제거
      },
      transports: {
        file: new FilteredFileTransport({
          dir: resolve(resolveProjectRoot(), "logs"),
          prefix: "mastra",
          omitFields: ["pid", "hostname"],
          excludePatterns: [
            "[Observability] Event exported",
            "Logger updated [component=",
            "Batch flushed",
            "[Observability] Initialized",
            "Logger updated for exporter",
          ],
        }),
      },
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
        // Chat Workflow (AI SDK SSE streaming — suspend/resume via tool approval)
        registerApiRoute("/chat", {
          method: "POST",
          handler: async (c) => {
            const body = await c.req.json();
            const workflow = mastra.getWorkflow("chatWorkflow");

            // Support both AI SDK format (messages) and old format (inputData/resumeData)
            const userId = body.userId || "default-user";
            const chatId: string | undefined = body.chatId || body.id;
            const incomingMessages: UIMessage[] = body.messages || [];
            const threadId =
              body.threadId ||
              chatId ||
              `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const activeMcpIds = await getUserActiveMcpIds(userId);

            // RequestContext 생성
            const requestContext = new RequestContext();
            requestContext.set("userId", userId);
            requestContext.set("threadId", threadId);
            requestContext.set("activeMcpIds", activeMcpIds);

            // Detect resume: clarify (suspendMeta), old-style (runId+resumeData), or AI SDK tool-approval
            console.log("[/chat] body keys:", Object.keys(body));
            console.log("[/chat] body.suspendMeta:", JSON.stringify(body.suspendMeta));
            const isClarifyResume = !!(body.suspendMeta?.runId);
            console.log("[/chat] isClarifyResume:", isClarifyResume);
            const isDirectResume = !isClarifyResume && !!(body.runId && body.resumeData);
            const isToolApprovalResume =
              !isClarifyResume &&
              !isDirectResume &&
              detectToolApprovalResume(incomingMessages);
            const isResume = isClarifyResume || isDirectResume || isToolApprovalResume;

            let streamOutput: any;
            let runId: string;

            if (isResume) {
              let meta: {
                runId: string;
                suspendedStep: string[] | string;
              };
              let resumeData: Record<string, unknown>;

              if (isClarifyResume) {
                // Clarify resume: suspendMeta from client + user's latest message as answer
                meta = {
                  runId: body.suspendMeta.runId,
                  suspendedStep: body.suspendMeta.suspendedStep,
                };
                const userAnswer = extractLastUserMessage(incomingMessages);
                resumeData = { userAnswer };
              } else if (isDirectResume) {
                // Old client format: { runId, suspendedStep, resumeData }
                meta = {
                  runId: body.runId,
                  suspendedStep: body.suspendedStep,
                };
                resumeData = body.resumeData;
              } else {
                // AI SDK tool-approval format
                ({ meta, resumeData } =
                  extractResumeData(incomingMessages));
              }

              const run = await workflow.createRun({
                runId: meta.runId,
              });
              runId = meta.runId;
              streamOutput = run.resumeStream({
                step: meta.suspendedStep,
                resumeData,
                requestContext,
              });

              // Clear persisted suspend meta on resume
              if (chatId) {
                updateChatSuspendMeta(chatId, null).catch(() => {});
              }
            } else {
              // === New: start workflow with latest user message ===
              const userText =
                body.inputData?.message ||
                extractLastUserMessage(incomingMessages);
              const run = await workflow.createRun();
              runId = run.runId;
              streamOutput = run.stream({
                inputData: { message: userText },
                initialState: {
                  executionTargets: [],
                  executionMode: "parallel" as const,
                  executionQueries: [],
                  retryCount: 0,
                  retryHistory: [],
                },
                requestContext,
                closeOnSuspend: true,
              });

              // Persist: create chat + save user message
              if (chatId) {
                try {
                  const existing = await getChatById(chatId);
                  if (!existing) {
                    const title =
                      userText.slice(0, 50) || "New Chat";
                    await createChat({ id: chatId, userId, title });
                  }
                  const lastUser = [...incomingMessages]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUser) {
                    await saveMessages([
                      {
                        id: lastUser.id,
                        chatId,
                        role: lastUser.role,
                        parts: lastUser.parts,
                      },
                    ]);
                  }
                } catch (e) {
                  console.error("[/chat] DB save user msg error:", e);
                }
              }
            }

            // AI SDK UI Message Stream
            const stream = createUIMessageStream({
              originalMessages: incomingMessages,
              execute: async ({ writer }) => {
                // Consume Mastra stream events in background (non-blocking)
                // This prevents the for-await iterator from blocking result access
                // if the stream doesn't terminate cleanly.
                streamOutput.consumeStream().catch((streamErr: unknown) => {
                  console.warn("[/chat] Stream consumption error:", streamErr);
                });

                try {
                // Await result directly — independent of stream consumption
                const result = await streamOutput.result;
                console.log(
                  "[/chat] Workflow result status:",
                  result.status,
                  "runId:",
                  runId,
                );
                console.log(
                  "[/chat] Result keys:",
                  Object.keys(result),
                  "result.result type:",
                  typeof result.result,
                  "result.result?.response?:",
                  !!result.result?.response,
                  "steps keys:",
                  result.steps ? Object.keys(result.steps) : "none",
                );

                if (result.status === "suspended") {
                  // Extract suspend payload (evented/non-evented engine)
                  const payload = extractSuspendPayload(result);

                  if (payload.hitlType === "clarify") {
                    // Clarify: 일반 텍스트 메시지로 질문 출력
                    const msgId = generateId();
                    writer.write({ type: "text-start", id: msgId });
                    writer.write({
                      type: "text-delta",
                      id: msgId,
                      delta:
                        payload.clarifyQuestion ||
                        "추가 정보를 알려주세요.",
                    });
                    writer.write({ type: "text-end", id: msgId });

                    // Suspend 메타데이터를 data part로 전달 (클라이언트가 다음 요청에 포함)
                    // transient: true → message.parts에 저장되지 않고 onData 콜백에만 전달
                    writer.write({
                      type: "data-suspend-meta" as const,
                      data: {
                        runId,
                        suspendedStep: payload.suspendedStep,
                        hitlType: "clarify",
                      },
                      transient: true,
                    });

                    // Persist suspend meta to DB for cross-navigation recovery
                    if (chatId) {
                      updateChatSuspendMeta(chatId, {
                        runId,
                        suspendedStep: payload.suspendedStep,
                        hitlType: "clarify",
                      }).catch((e) =>
                        console.error("[/chat] Failed to save suspend meta:", e),
                      );
                    }
                  } else {
                    // Ambiguous: 기존 tool-approval 방식 유지
                    const toolCallId = generateId();
                    const approvalId = generateId();
                    writer.write({
                      type: "tool-input-available",
                      toolCallId,
                      toolName: "selectExecutionPlan",
                      input: {
                        candidates: payload.candidates || [],
                        _meta: {
                          runId,
                          suspendedStep: payload.suspendedStep,
                        },
                      },
                    });
                    writer.write({
                      type: "tool-approval-request",
                      approvalId,
                      toolCallId,
                    });
                  }
                } else {
                  // Completed → text chunk
                  // Mastra evented engine: result may be at different paths
                  const text =
                    result.result?.response ??
                    (typeof result.result === "string"
                      ? result.result
                      : null) ??
                    "워크플로우가 종료되었습니다.";
                  const msgId = generateId();
                  writer.write({ type: "text-start", id: msgId });
                  writer.write({
                    type: "text-delta",
                    id: msgId,
                    delta: text,
                  });
                  writer.write({ type: "text-end", id: msgId });

                  // Ensure suspend meta is cleared on completion
                  if (chatId) {
                    updateChatSuspendMeta(chatId, null).catch(() => {});
                  }

                  // Sync Memory-generated thread title to chat DB (on completion only)
                  if (chatId) {
                    try {
                      const thread = await conversationMemory.getThreadById({
                        threadId,
                      });
                      if (thread?.title) {
                        await updateChatTitle(chatId, thread.title);
                        console.log(
                          "[/chat] Title synced: %s → %s",
                          chatId,
                          thread.title,
                        );
                      }
                    } catch (e) {
                      console.error("[/chat] Title sync error:", e);
                    }
                  }
                }
                } catch (resultErr) {
                  console.error("[/chat] Result processing error:", resultErr);
                  const msgId = generateId();
                  writer.write({ type: "text-start", id: msgId });
                  writer.write({
                    type: "text-delta",
                    id: msgId,
                    delta: `워크플로우 처리 중 오류가 발생했습니다: ${resultErr instanceof Error ? resultErr.message : String(resultErr)}`,
                  });
                  writer.write({ type: "text-end", id: msgId });
                }
              },
              onFinish: async ({ responseMessage }) => {
                // Save assistant response to DB
                if (chatId && responseMessage) {
                  try {
                    await saveMessages([
                      {
                        id: responseMessage.id,
                        chatId,
                        role: responseMessage.role,
                        parts: responseMessage.parts as unknown[],
                      },
                    ]);
                  } catch (e) {
                    console.error(
                      "[/chat] DB save assistant msg error:",
                      e,
                    );
                  }
                }
              },
            });

            return createUIMessageStreamResponse({
              stream,
              headers: {
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache",
              },
            });
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

// ── Helper functions for AI SDK tool-approval HITL ──

interface SuspendPayloadResult {
  hitlType: "clarify" | "ambiguous";
  clarifyQuestion?: string;
  candidates?: Array<{
    planId: string;
    label: string;
    description: string;
    targets: string[];
    executionMode: "parallel" | "sequential";
    expectedOutcome: string;
  }>;
  originalMessage?: string;
  suspendedStep: string[] | string;
}

/** Check if last assistant message has tool-approval-responded parts */
function detectToolApprovalResume(messages: UIMessage[]): boolean {
  // 마지막 메시지가 user면 새 질문 → resume 아님
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "user") return false;

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  return lastAssistant.parts.some(
    (p: any) =>
      (p.type === "dynamic-tool" || p.type?.startsWith("tool-")) &&
      p.state === "approval-responded",
  );
}

/** Extract resume data from tool-approval-responded part */
function extractResumeData(messages: UIMessage[]): {
  meta: { runId: string; suspendedStep: string[] | string };
  resumeData: Record<string, unknown>;
} {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const toolPart = lastAssistant?.parts.find(
    (p: any) =>
      (p.type === "dynamic-tool" || p.type?.startsWith("tool-")) &&
      p.state === "approval-responded",
  ) as any;

  const meta = toolPart?.input?._meta || {};
  const toolName = toolPart?.toolName;

  if (toolName === "requestClarification") {
    // Clarify: reason = user's text answer
    return {
      meta,
      resumeData: { userAnswer: toolPart?.approval?.reason || "" },
    };
  } else {
    // Ambiguous: reason = JSON.stringify({ selectedPlan, selectedTargets, selectedExecutionMode })
    try {
      const parsed = JSON.parse(toolPart?.approval?.reason || "{}");
      return { meta, resumeData: parsed };
    } catch {
      return { meta, resumeData: {} };
    }
  }
}

/** Extract last user text message from messages array */
function extractLastUserMessage(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  const textPart = lastUser.parts.find((p: any) => p.type === "text") as any;
  return textPart?.text ?? "";
}

/** Extract suspend payload from workflow result (evented/non-evented engine) */
function extractSuspendPayload(result: any): SuspendPayloadResult {
  const suspendedStep = result.suspended?.[0] || [];
  const topStepId = suspendedStep?.[0];

  let suspendPayload: any;

  // 1) Evented engine: result.steps[stepId].suspendPayload
  if (topStepId && result.steps?.[topStepId]?.suspendPayload) {
    const stepPayload = result.steps[topStepId].suspendPayload;
    const { __workflow_meta, ...userPayload } = stepPayload;
    suspendPayload = userPayload;
  }
  // 2) Non-evented engine fallback
  if (!suspendPayload && result.suspendPayload) {
    const rawPayload = result.suspendPayload as Record<string, any>;
    suspendPayload =
      rawPayload?.[topStepId || "classify-and-execute"] || rawPayload;
  }

  return {
    hitlType: suspendPayload?.hitlType || "clarify",
    clarifyQuestion: suspendPayload?.clarifyQuestion,
    candidates: suspendPayload?.candidates,
    originalMessage: suspendPayload?.originalMessage,
    suspendedStep,
  };
}
