import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const MASTRA_URL =
  process.env.MASTRA_SERVER_URL || "http://localhost:4111";

/**
 * A2A 프로토콜로 다른 Agent를 호출하는 범용 도구
 *
 * Supervisor Agent가 이 도구를 사용하여 A2A Agent에게
 * JSON-RPC 2.0 메시지를 전송하고 응답을 받습니다.
 *
 * A2AClient의 상대 URL 파싱 이슈를 회피하기 위해 직접 HTTP 호출합니다.
 */
export const callA2AAgent = createTool({
  id: "call-a2a-agent",
  description:
    "A2A 프로토콜로 다른 Agent를 호출합니다. agentId와 message를 지정하면 해당 Agent에게 JSON-RPC 2.0으로 메시지를 전송하고 응답을 반환합니다.",
  inputSchema: z.object({
    agentId: z
      .string()
      .describe(
        "호출할 Agent ID (예: a2aAtlassian, a2aGoogleSearch, a2aDataHub, a2aChatbot)",
      ),
    message: z.string().describe("Agent에게 보낼 메시지"),
    context: z
      .string()
      .optional()
      .describe("이전 Agent 호출 결과 등 참고 컨텍스트"),
    baseUrl: z
      .string()
      .optional()
      .describe(
        "외부 A2A 서버의 base URL (예: http://localhost:5000). 생략 시 로컬 Mastra 서버 사용. A2A 엔드포인트는 {baseUrl}/api/a2a/{agentId} 형태여야 합니다.",
      ),
  }),
  outputSchema: z.object({
    agentId: z.string(),
    status: z.string(),
    response: z.string(),
  }),
  execute: async ({ agentId, message, context: prevContext, baseUrl }) => {
    const fullMessage = prevContext
      ? `${message}\n\n[이전 단계 결과]\n${prevContext}`
      : message;

    // A2A JSON-RPC 2.0 직접 호출 (외부 서버 지원)
    const serverUrl = baseUrl || MASTRA_URL;
    const res = await fetch(`${serverUrl}/api/a2a/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "message/send",
        params: {
          message: {
            kind: "message",
            messageId: crypto.randomUUID(),
            role: "user",
            parts: [{ kind: "text", text: fullMessage }],
          },
          configuration: {
            acceptedOutputModes: ["text"],
            blocking: true,
          },
        },
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

    // JSON-RPC 에러 처리
    if (data.error) {
      return {
        agentId,
        status: "error",
        response: `A2A 에러: ${data.error.message || JSON.stringify(data.error)}`,
      };
    }

    // 응답 파싱 (Task 또는 Message)
    const result = data.result;
    let responseText = "(응답 없음)";

    if (result?.kind === "task") {
      const parts = result.status?.message?.parts || [];
      responseText = parts
        .filter((p: any) => p.kind === "text")
        .map((p: any) => p.text)
        .join("\n");
    } else if (result?.kind === "message") {
      responseText = (result.parts || [])
        .filter((p: any) => p.kind === "text")
        .map((p: any) => p.text)
        .join("\n");
    }

    return {
      agentId,
      status:
        result?.kind === "task"
          ? result.status?.state || "unknown"
          : "completed",
      response: responseText,
    };
  },
});
