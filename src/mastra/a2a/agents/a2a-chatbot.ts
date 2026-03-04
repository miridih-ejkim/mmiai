import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * chat-workflow 실행 도구
 *
 * 기존 chatWorkflow 전체를 하나의 Tool로 래핑합니다.
 * A2A 핸들러가 agent.generate()를 호출하면, Agent가 이 도구를 사용하여
 * workflow를 실행하고 결과를 반환합니다.
 *
 * 주의: HITL(suspend/resume)은 A2A에서 동작하지 않습니다.
 * simple/agent 경로만 정상 동작하며, clarify/ambiguous 시 timeout됩니다.
 */
const runChatWorkflow = createTool({
  id: "run-chat-workflow",
  description:
    "사내 도구(Confluence, Jira, DataHub, 웹 검색)를 활용하여 질문에 답변합니다. 질문을 자동 분류하고 적절한 도구로 검색한 후 종합 답변을 생성합니다.",
  inputSchema: z.object({
    query: z.string().describe("사용자의 질문"),
  }),
  outputSchema: z.object({
    result: z.string().describe("워크플로우 실행 결과"),
  }),
  execute: async ({ query }, context) => {
    const mastra = context?.mastra;
    if (!mastra) {
      return { result: "Mastra 인스턴스에 접근할 수 없습니다." };
    }

    try {
      const workflow = mastra.getWorkflow("chatWorkflow");
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { message: query },
        initialState: {
          executionTargets: [],
          executionMode: "parallel" as const,
          executionQueries: [],
          retryCount: 0,
          retryHistory: [],
        },
      });

      if (result.status === "suspended") {
        return {
          result:
            "이 질문은 추가 정보가 필요합니다. 사내 챗봇(Chat 탭)에서 직접 질문해주세요.",
        };
      }

      // 타입 좁히기: success/failed 모두 steps는 있지만 result는 success만
      const r = result as any;
      const text =
        r.result?.response ??
        r.steps?.["synthesize-response"]?.output?.response ??
        (typeof r.result === "string" ? r.result : null) ??
        "워크플로우 실행이 완료되었습니다.";

      return { result: text };
    } catch (error) {
      return {
        result: `워크플로우 실행 오류: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

/**
 * A2A Chatbot Agent
 *
 * 기존 chat-workflow를 하나의 A2A Agent로 노출합니다.
 * 다른 A2A Agent가 "사내 도구 챗봇"을 호출할 때 사용됩니다.
 */
export const a2aChatbot = new Agent({
  id: "a2aChatbot",
  name: "MMIAI 사내 챗봇",
  description:
    "Confluence/Jira 문서 검색, DataHub 데이터 카탈로그 조회, 웹 검색을 활용하는 사내 통합 도구 챗봇. 질문을 자동 분류하고 적절한 도구로 답변합니다.",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions:
    "사용자의 질문을 받으면 run-chat-workflow 도구를 호출하여 답변하세요. 도구의 결과를 사용자에게 그대로 전달하세요. 도구 호출 없이 직접 답변하지 마세요.",
  tools: { runChatWorkflow },
});
