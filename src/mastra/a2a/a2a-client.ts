/**
 * A2A Client Utility
 *
 * @a2a-js/sdk A2AClient 기반 공유 유틸리티.
 * Agent Card 조회, 메시지 전송, 응답 파싱을 통합.
 * 서버(Node.js)와 브라우저 환경 모두에서 동작.
 */
import { A2AClient } from "@a2a-js/sdk/client";
import type {
  Message,
  MessageSendParams,
  Task,
  Part,
  TextPart,
  AgentCard,
  Artifact,
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

// ── A2AClient Cache ──

const clientCache = new Map<string, A2AClient>();

/**
 * Agent별 A2AClient 인스턴스를 캐시하여 반환.
 *
 * Mastra agent card는 url 필드를 상대 경로("/a2a/:agentId")로 반환하는데,
 * SDK는 이를 그대로 fetch에 전달하여 Node.js에서 실패함.
 * → agent card fetch 후 serviceEndpointUrl을 절대 URL로 패치.
 */
async function getOrCreateClient(agentId: string, baseUrl?: string): Promise<A2AClient> {
  const base = (baseUrl || getDefaultBaseUrl()).replace(/\/$/, "");
  const cacheKey = `${base}::${agentId}`;

  let client = clientCache.get(cacheKey);
  if (!client) {
    // Mastra의 agent card 경로: /api prefix 필수 (서버 기본 prefix)
    const agentCardPath = `api/.well-known/${agentId}/agent-card.json`;
    client = new A2AClient(base, agentCardPath);
    clientCache.set(cacheKey, client);

    // agent card fetch 완료 대기 후, 상대 경로를 절대 URL로 패치
    // Mastra Agent Card는 url을 "/a2a/:agentId"로 반환하지만,
    // 실제 엔드포인트는 "/api/a2a/:agentId" (/api prefix 필수)
    await client.getAgentCard();
    let ep = (client as any).serviceEndpointUrl as string | undefined;
    if (ep && ep.startsWith("/")) {
      // /a2a/... → /api/a2a/... 보정 (Mastra Agent Card 누락 대응)
      if (ep.startsWith("/a2a/") && !ep.startsWith("/api/")) {
        ep = `/api${ep}`;
      }
      (client as any).serviceEndpointUrl = `${base}${ep}`;
    }
  }
  return client;
}

// ── Send ──

export async function sendA2AMessage(
  options: A2ASendOptions,
): Promise<A2AResponse> {
  const { agentId, message, contextId, baseUrl, context } = options;

  const fullMessage = context
    ? `${message}\n\n[이전 단계 결과]\n${context}`
    : message;

  const params: MessageSendParams = {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      parts: [{ kind: "text", text: fullMessage }],
      kind: "message",
      ...(contextId && { contextId }),
    },
    configuration: {
      acceptedOutputModes: ["text"],
      blocking: true,
    },
  };

  try {
    const client = await getOrCreateClient(agentId, baseUrl);
    const response = await client.sendMessage(params);
    return parseA2AResult(agentId, response);
  } catch (error) {
    return {
      agentId,
      status: "error",
      response: `A2A 호출 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── Response Parsing ──

/**
 * SDK SendMessageResponse(Message | Task)를 앱 A2AResponse로 변환
 */
function parseA2AResult(
  agentId: string,
  result: unknown,
): A2AResponse {
  if (!result || typeof result !== "object") {
    return { agentId, status: "unknown", response: "(응답 없음)" };
  }

  // JSON-RPC envelope 언래핑: { jsonrpc, id, result: { kind, ... } }
  const obj = result as Record<string, unknown>;
  const inner = (obj.jsonrpc && obj.result && typeof obj.result === "object")
    ? obj.result as Record<string, unknown>
    : obj;

  if (inner.kind === "message") {
    return parseMessageResponse(agentId, inner as unknown as Message);
  }

  if (inner.kind === "task") {
    return parseTaskResponse(agentId, inner as unknown as Task);
  }

  if (typeof inner === "string") {
    return { agentId, status: "completed", response: inner as unknown as string };
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
): Promise<AgentCard | null> {
  try {
    const client = await getOrCreateClient(agentId, baseUrl);
    return await client.getAgentCard();
  } catch {
    return null;
  }
}
