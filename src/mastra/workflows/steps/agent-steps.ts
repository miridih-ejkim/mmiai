import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { classificationOutputSchema } from "./classify-intent";

/**
 * Agent 실행 결과 스키마
 * 모든 경로(direct, single-agent, multi-agent)에서 동일한 형태로 반환
 * .branch()의 모든 분기가 동일한 outputSchema를 가져야 하므로 공유
 */
export const agentResultSchema = z.object({
  source: z
    .string()
    .describe(
      "결과 출처 (direct, atlassian, google-search, datahub, multi-agent)",
    ),
  content: z.string().describe("Agent 실행 결과 텍스트"),
  success: z.boolean().describe("실행 성공 여부"),
});

export type AgentResult = z.infer<typeof agentResultSchema>;

/**
 * Direct Response Step (simple 분기)
 * Agent 호출 없이 Classifier의 reasoning을 직접 전달
 */
export const directResponseStep = createStep({
  id: "direct-response",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData }) => {
    return {
      source: "direct",
      content: inputData.reasoning,
      success: true,
    };
  },
});

/**
 * Atlassian Agent Step (atlassian 분기)
 * Confluence/Jira 검색 전문
 */
export const atlassianAgentStep = createStep({
  id: "atlassian-agent-step",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["atlassian"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("atlassianAgent");
      const result = await agent.generate(query);
      return { source: "atlassian", content: result.text, success: true };
    } catch (error) {
      return {
        source: "atlassian",
        content: `Atlassian Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});

/**
 * Google Search Agent Step (google-search 분기)
 * 웹 검색 및 콘텐츠 추출 전문
 */
export const googleSearchAgentStep = createStep({
  id: "google-search-agent-step",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["google-search"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("googleSearchAgent");
      const result = await agent.generate(query);
      return {
        source: "google-search",
        content: result.text,
        success: true,
      };
    } catch (error) {
      return {
        source: "google-search",
        content: `Google Search Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});

/**
 * DataHub Agent Step (datahub 분기)
 * 데이터 카탈로그 조회 전문
 */
export const datahubAgentStep = createStep({
  id: "datahub-agent-step",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["datahub"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("dataHubAgent");
      const result = await agent.generate(query);
      return { source: "datahub", content: result.text, success: true };
    } catch (error) {
      return {
        source: "datahub",
        content: `DataHub Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});

/**
 * Multi-Agent 병렬 실행용 Steps
 * .parallel() 내부에서 사용되며, targets에 포함되지 않으면 빈 결과 반환
 */
export const parallelAtlassianStep = createStep({
  id: "parallel-atlassian",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    if (!inputData.targets.includes("atlassian")) {
      return { source: "atlassian", content: "", success: false };
    }
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["atlassian"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("atlassianAgent");
      const result = await agent.generate(query);
      return { source: "atlassian", content: result.text, success: true };
    } catch (error) {
      return {
        source: "atlassian",
        content: `Atlassian Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});

export const parallelGoogleSearchStep = createStep({
  id: "parallel-google-search",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    if (!inputData.targets.includes("google-search")) {
      return { source: "google-search", content: "", success: false };
    }
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["google-search"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("googleSearchAgent");
      const result = await agent.generate(query);
      return {
        source: "google-search",
        content: result.text,
        success: true,
      };
    } catch (error) {
      return {
        source: "google-search",
        content: `Google Search Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});

export const parallelDatahubStep = createStep({
  id: "parallel-datahub",
  inputSchema: classificationOutputSchema,
  outputSchema: agentResultSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    if (!inputData.targets.includes("datahub")) {
      return { source: "datahub", content: "", success: false };
    }
    const initData = getInitData<{ message: string }>();
    const query =
      inputData.queries["datahub"] || initData?.message || "";

    try {
      const agent = mastra!.getAgent("dataHubAgent");
      const result = await agent.generate(query);
      return { source: "datahub", content: result.text, success: true };
    } catch (error) {
      return {
        source: "datahub",
        content: `DataHub Agent 오류: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  },
});
