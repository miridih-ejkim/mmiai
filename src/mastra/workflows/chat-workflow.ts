import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  classifyIntentStep,
  classificationOutputSchema,
} from "./steps/classify-intent";
import {
  agentResultSchema,
  directResponseStep,
  atlassianAgentStep,
  googleSearchAgentStep,
  datahubAgentStep,
  parallelAtlassianStep,
  parallelGoogleSearchStep,
  parallelDatahubStep,
} from "./steps/agent-steps";
import { mergeResultsStep } from "./steps/merge-results";
import { synthesizeResponseStep } from "./steps/synthesize-response";
import { qualityCheckStep } from "./steps/quality-check";

/**
 * Multi-Agent Sub-Workflow
 * multi-agent 분기에서 사용: 대상 Agent들을 병렬 실행 후 결과 병합
 */
const multiAgentWorkflow = createWorkflow({
  id: "multi-agent-workflow",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
})
  .parallel([
    parallelAtlassianStep,
    parallelGoogleSearchStep,
    parallelDatahubStep,
  ])
  .then(mergeResultsStep)
  .commit();

/**
 * Chat Workflow
 *
 * CLAUDE.md 아키텍처에 따른 결정적 Workflow 구조:
 *
 * Step 1 (classify-intent):
 *   Classifier Agent (Haiku)가 의도를 분류하여 structured output 반환
 *
 * .branch() (결정적 분기):
 *   분류 결과의 type에 따라 해당 Agent Step으로 직접 라우팅
 *   - simple → directResponseStep (Agent 호출 없음)
 *   - atlassian → atlassianAgentStep
 *   - google-search → googleSearchAgentStep
 *   - datahub → datahubAgentStep
 *   - multi-agent → multiAgentWorkflow (.parallel() + merge)
 *
 * .map() (출력 정규화):
 *   .branch() 출력에서 실행된 분기의 결과만 추출
 *
 * Quality Check (quality-check):
 *   Scorer 기반 품질 평가 → 통과 시 다음 Step, 실패 시 suspend (HITL)
 *   Resume 시 사용자 피드백으로 Agent 재실행
 *
 * Final Step (synthesize-response):
 *   Final Responser Agent (Haiku)가 결과를 사용자 친화적 응답으로 합성
 *   writer.pipeTo()로 실시간 스트리밍
 *
 * 스키마 흐름:
 *   { message } → { type, targets[], queries{}, reasoning }
 *     → .branch() → { "step-id"?: { source, content, success } }
 *       → .map() → { source, content, success }
 *         → quality-check (suspend 가능)
 *           → { response }
 */
export const chatWorkflow = createWorkflow({
  id: "chat-workflow",
  inputSchema: z.object({
    message: z.string(),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
})
  .then(classifyIntentStep)
  .branch([
    [
      async ({ inputData }) => inputData.type === "simple",
      directResponseStep,
    ],
    [
      async ({ inputData }) => inputData.type === "atlassian",
      atlassianAgentStep,
    ],
    [
      async ({ inputData }) => inputData.type === "google-search",
      googleSearchAgentStep,
    ],
    [
      async ({ inputData }) => inputData.type === "datahub",
      datahubAgentStep,
    ],
    [
      async ({ inputData }) => inputData.type === "multi-agent",
      multiAgentWorkflow,
    ],
  ])
  .map(async ({ inputData }) => {
    // .branch() 출력: 실행된 분기의 step-id를 키로 결과 반환
    // 어떤 분기가 실행되었든 하나의 agentResultSchema로 정규화
    const result =
      inputData["direct-response"] ||
      inputData["atlassian-agent-step"] ||
      inputData["google-search-agent-step"] ||
      inputData["datahub-agent-step"] ||
      inputData["multi-agent-workflow"];

    return result || { source: "unknown", content: "", success: false };
  })
  .then(qualityCheckStep)
  .then(synthesizeResponseStep)
  .commit();
