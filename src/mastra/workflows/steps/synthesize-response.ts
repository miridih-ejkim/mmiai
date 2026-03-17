import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { agentResultSchema } from "./agent-steps";
import { workflowStateSchema } from "../state";

/**
 * 응답 합성 Step
 *
 * Final Responser Agent (Haiku)가 Agent 실행 결과를 사용자 친화적 응답으로 합성합니다.
 * 루프 내부(quality-check 앞)에서 실행되어, Scorer가 합성된 자연어 답변을 평가할 수 있도록 합니다.
 *
 * input: agentResultSchema (source, content, success, confidence?)
 * output: agentResultSchema (source 유지, content를 합성 답변으로 교체)
 */
export const synthesizeResponseStep = createStep({
  id: "synthesize-response",
  inputSchema: agentResultSchema,
  outputSchema: agentResultSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, mastra, getInitData, requestContext, state }) => {
    // direct 응답은 합성 불필요 — 그대로 전달
    if (inputData.source === "direct") {
      return inputData;
    }

    const initData = getInitData<{ message: string }>();
    const agent = mastra!.getAgent("finalResponserAgent");

    const userId =
      (requestContext?.get("userId") as string | undefined) || "default-user";
    const threadId =
      (requestContext?.get("threadId") as string | undefined) ||
      "default-thread";

    const source = inputData.source || "unknown";
    const content = inputData.content || "";
    const success = inputData.success ?? true;

    // clarify resume 시 사용자가 제공한 추가 정보
    const clarifyAnswer = state?.clarifyAnswer;
    const userQuestion = initData?.message || state?.originalMessage || "";

    const prompt = `사용자 질문: ${userQuestion}
${clarifyAnswer ? `\n사용자가 추가로 제공한 정보: ${clarifyAnswer}\n` : ""}
검색 결과 (출처: ${source}):
${content}

위 검색 결과를 기반으로 사용자에게 도움이 되는 응답을 작성하세요.
${!success ? "\n주의: 일부 검색에서 오류가 발생했습니다. 사용 가능한 정보만으로 응답하되, 오류 사실도 안내하세요." : ""}`;

    const response = await agent.generate(prompt, {
      memory: {
        resource: userId,
        thread: threadId,
      },
    });

    return {
      source: inputData.source,
      content: response.text,
      success: inputData.success,
      confidence: inputData.confidence,
    };
  },
});
