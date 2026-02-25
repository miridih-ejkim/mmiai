import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";

/**
 * Step 3: 응답 합성 + 스트리밍
 *
 * Final Responser Agent (Haiku)가 Agent 실행 결과를 사용자 친화적 응답으로 합성합니다.
 * writer.pipeTo()로 실시간 텍스트 스트리밍을 지원합니다.
 */
export const synthesizeResponseStep = createStep({
  id: "synthesize-response",
  inputSchema: agentResultSchema,
  outputSchema: z.object({
    response: z.string(),
  }),
  execute: async ({ inputData, mastra, writer, getInitData, requestContext }) => {
    const initData = getInitData<{ message: string }>();
    const agent = mastra!.getAgent("finalResponserAgent");

    // Memory 연동: userId(resource) + threadId(thread)로 대화 응답 자동 기록
    const userId =
      (requestContext?.get("userId") as string | undefined) || "default-user";
    const threadId =
      (requestContext?.get("threadId") as string | undefined) ||
      "default-thread";

    let prompt: string;

    if (inputData.source === "direct") {
      // simple 타입: 사용자 메시지를 기반으로 직접 응답
      prompt = initData?.message || inputData.content;
    } else {
      // Agent 결과를 기반으로 응답 합성
      prompt = `사용자 질문: ${initData?.message || ""}

검색 결과 (출처: ${inputData.source}):
${inputData.content}

위 검색 결과를 기반으로 사용자에게 도움이 되는 응답을 작성하세요.
${!inputData.success ? "\n주의: 일부 검색에서 오류가 발생했습니다. 사용 가능한 정보만으로 응답하되, 오류 사실도 안내하세요." : ""}`;
    }

    // 실시간 스트리밍 + 공유 Memory에 대화 자동 기록
    // classifier가 같은 thread를 recall하여 대화 맥락을 유지
    const response = await agent.stream(prompt, {
      memory: {
        resource: userId,
        thread: threadId,
      },
    });
    await response.fullStream.pipeTo(writer);

    return {
      response: await response.text,
    };
  },
});
