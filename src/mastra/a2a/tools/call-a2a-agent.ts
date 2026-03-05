import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sendA2AMessage } from "../a2a-client";
import type { A2AResponse } from "../a2a-client";

/**
 * A2A 프로토콜로 다른 Agent를 호출하는 범용 도구
 *
 * Supervisor Agent가 이 도구를 사용하여 A2A Agent를 호출합니다.
 *
 * 라우팅 전략:
 * - 로컬 Agent (baseUrl 없음): mastra.getAgent()로 직접 호출 (HTTP 루프백 회피)
 * - 외부 Agent (baseUrl 있음): A2A JSON-RPC 2.0 HTTP 호출
 */
export const callA2AAgent = createTool({
  id: "call-a2a-agent",
  description:
    "A2A 프로토콜로 다른 Agent를 호출합니다. agentId와 message를 지정하면 해당 Agent에게 메시지를 전송하고 응답을 반환합니다.",
  inputSchema: z.object({
    agentId: z
      .string()
      .describe("호출할 Agent ID (예: a2aChatbot, a2aSupervisor)"),
    message: z.string().describe("Agent에게 보낼 메시지"),
    context: z
      .string()
      .optional()
      .describe("이전 Agent 호출 결과 등 참고 컨텍스트"),
    contextId: z
      .string()
      .optional()
      .describe(
        "A2A 대화 세션 ID. 같은 Agent에 대한 연속 호출 시 이전 응답의 contextId를 전달하여 대화 맥락 유지",
      ),
    baseUrl: z
      .string()
      .optional()
      .describe(
        "외부 A2A 서버의 base URL (예: http://localhost:5000). 생략 시 로컬 Agent를 직접 호출.",
      ),
  }),
  outputSchema: z.object({
    agentId: z.string(),
    taskId: z.string().optional().describe("서버가 생성한 Task ID"),
    contextId: z.string().optional().describe("대화 세션 ID (후속 호출에 재사용)"),
    status: z.string().describe("Task 상태 (completed, failed, working 등)"),
    response: z.string(),
  }),
  execute: async (
    { agentId, message, context: prevContext, contextId, baseUrl },
    toolContext,
  ) => {
    // 외부 Agent: A2A HTTP 호출
    if (baseUrl) {
      return sendA2AMessage({
        agentId,
        message,
        context: prevContext,
        contextId,
        baseUrl,
      });
    }

    // 로컬 Agent: Mastra 직접 호출 (HTTP 루프백 회피 → 타임아웃 방지)
    const mastra = toolContext?.mastra;
    if (!mastra) {
      return sendA2AMessage({ agentId, message, context: prevContext, contextId });
    }

    try {
      const agent = (mastra as any).getAgent(agentId);
      if (!agent) {
        return {
          agentId,
          status: "error",
          response: `로컬 Agent를 찾을 수 없습니다: ${agentId}`,
        };
      }

      const fullMessage = prevContext
        ? `${message}\n\n[이전 단계 결과]\n${prevContext}`
        : message;

      const result = await agent.generate(fullMessage);
      const responseText =
        typeof result.text === "string"
          ? result.text
          : JSON.stringify(result.text);

      return {
        agentId,
        status: "completed",
        response: responseText || "(응답 없음)",
      } satisfies A2AResponse;
    } catch (error) {
      return {
        agentId,
        status: "error",
        response: `로컬 Agent 호출 오류: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
