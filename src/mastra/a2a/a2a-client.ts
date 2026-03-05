/**
 * A2A Client Utility
 *
 * @a2a-js/sdk 타입 기반 공유 유틸리티.
 * JSON-RPC 2.0 메시지 전송, 응답 파싱, Agent Card 조회를 통합.
 * 서버(Node.js)와 브라우저 환경 모두에서 동작.
 *
 * A2AClient 클래스를 직접 사용하지 않는 이유:
 * - Mastra의 agent card 경로가 비표준 (/api/.well-known/{agentId}/agent-card.json)
 * - Agent card의 url 필드가 relative path라 Node.js fetch()에서 실패
 * - 1 client = 1 agent 모델이라 multi-agent 서버에서 비효율적
 */
import type {
  Message,
  MessageSendParams,
  Task,
  Part,
  TextPart,
  AgentCard,
  Artifact,
  SendMessageResponse,
  JSONRPCErrorResponse,
} from "@a2a-js/sdk";

// ── Types ──

/** API 응답용 확장 AgentCard — SDK AgentCard + 앱 고유 라우팅 필드 */
export interface A2AAgentCardWithMeta extends AgentCard {
  id: string;
  source: "local" | "external";
  baseUrl?: string;
  serverId?: string;
}

export interface A2ASendOptions {
  agentId: string;
  message: string;
  contextId?: string;
  baseUrl?: string;
  context?: string;
  signal?: AbortSignal;
}

export interface A2AResponse {
  agentId: string;
  taskId?: string;
  contextId?: string;
  status: string;
  response: string;
}

// ── Endpoint ──

function getDefaultBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "/mastra";
  }
  return process.env.MASTRA_SERVER_URL || "http://localhost:4111";
}

export function getA2AEndpoint(
  agentId: string,
  baseUrl?: string,
): string {
  const base = baseUrl || getDefaultBaseUrl();
  return `${base}/api/a2a/${agentId}`;
}

// ── Message Building ──

export function buildMessageSendParams(
  text: string,
  options?: { contextId?: string; messageId?: string },
): MessageSendParams {
  const message: Message = {
    kind: "message",
    messageId: options?.messageId || crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text }],
    ...(options?.contextId && { contextId: options.contextId }),
  };

  return {
    message,
    configuration: {
      acceptedOutputModes: ["text"],
      blocking: true,
    },
  };
}

// ── Send ──

export async function sendA2AMessage(
  options: A2ASendOptions,
): Promise<A2AResponse> {
  const { agentId, message, contextId, baseUrl, context, signal } = options;

  const fullMessage = context
    ? `${message}\n\n[이전 단계 결과]\n${context}`
    : message;

  const endpoint = getA2AEndpoint(agentId, baseUrl);
  const params = buildMessageSendParams(fullMessage, { contextId });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params,
    }),
  });

  if (!res.ok) {
    return {
      agentId,
      status: "error",
      response: `A2A 호출 실패: HTTP ${res.status}`,
    };
  }

  const data = await res.json();
  return parseA2AResponse(agentId, data);
}

// ── Response Parsing ──

export function parseA2AResponse(
  agentId: string,
  data: { result?: unknown; error?: { message?: string } },
): A2AResponse {
  if (data.error) {
    return {
      agentId,
      status: "error",
      response: `A2A 에러: ${data.error.message || JSON.stringify(data.error)}`,
    };
  }

  const result = data.result as Record<string, unknown> | undefined;

  if (result?.kind === "task") {
    return parseTaskResponse(agentId, result as unknown as Task);
  }

  if (result?.kind === "message") {
    return parseMessageResponse(agentId, result as unknown as Message);
  }

  if (typeof result === "string") {
    return { agentId, status: "completed", response: result };
  }

  return { agentId, status: "unknown", response: "(응답 없음)" };
}

function parseTaskResponse(agentId: string, task: Task): A2AResponse {
  const statusText = extractTextFromParts(
    (task.status?.message as { parts?: Part[] })?.parts || [],
  );

  const artifactTexts = (task.artifacts || [])
    .flatMap((a: Artifact) => a.parts)
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text);

  const fullResponse = [statusText, ...artifactTexts]
    .filter(Boolean)
    .join("\n\n") || "(응답 없음)";

  return {
    agentId,
    taskId: task.id,
    contextId: task.contextId,
    status: task.status?.state || "unknown",
    response: fullResponse,
  };
}

function parseMessageResponse(
  agentId: string,
  message: Message,
): A2AResponse {
  return {
    agentId,
    contextId: message.contextId,
    status: "completed",
    response: extractTextFromParts(message.parts) || "(응답 없음)",
  };
}

/**
 * Part[] 에서 TextPart만 추출하여 텍스트로 결합
 */
export function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join("\n");
}

// ── Agent Discovery ──

export async function fetchAgentIds(
  baseUrl: string,
  options?: { signal?: AbortSignal },
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/agents`, {
      cache: "no-store",
      signal: options?.signal || AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Object.keys(data);
  } catch {
    return [];
  }
}

export async function fetchAgentCard(
  baseUrl: string,
  agentId: string,
  options?: { signal?: AbortSignal },
): Promise<AgentCard | null> {
  try {
    const url = `${baseUrl}/api/.well-known/${agentId}/agent-card.json`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: options?.signal || AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}
