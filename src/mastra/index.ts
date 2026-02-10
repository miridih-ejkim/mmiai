// top-level await (ESM)
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";

import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { workflowRoute } from "@mastra/ai-sdk";
import { registerApiRoute } from "@mastra/core/server";

import { mcpServers, mcpToolsByService, disconnectMcp } from "./mcp";
import {
  createAtlassianAgent,
  createGoogleSearchAgent,
  createDataHubAgent,
} from "./agents/workers";
import { createClassifierAgent } from "./agents/classifier-agent";
import { createFinalResponserAgent } from "./agents/final-responser";
import { chatWorkflow } from "./workflows/chat-workflow";

/**
 * Mastra 인스턴스 비동기 초기화
 *
 * Deterministic Workflow 구조:
 * - Step 1: Classifier Agent (Haiku) → 의도 분류 (structured output)
 * - .branch(): 분류 결과에 따라 결정적 분기
 *   - simple → 직접 응답
 *   - single-agent → 해당 Worker Agent 호출
 *   - multi-agent → .parallel() 병렬 실행 + merge
 * - .map(): 출력 정규화
 * - Final: Final Responser Agent (Haiku) → 응답 합성 + 스트리밍
 */
export async function initializeMastra(): Promise<{
  mastra: Mastra;
  shutdown: () => Promise<void>;
}> {
  // Worker Agents 생성 (서비스별 MCP 도구 주입)
  const atlassianAgent = createAtlassianAgent(mcpToolsByService.atlassian);
  const googleSearchAgent = createGoogleSearchAgent(
    mcpToolsByService.googleSearch,
  );
  const dataHubAgent = createDataHubAgent(mcpToolsByService.datahub);

  // Classifier Agent 생성 (의도 분류 전용, 도구/메모리 없음)
  const classifierAgent = createClassifierAgent();

  // Final Responser Agent 생성 (응답 합성 전용, 도구/메모리 없음)
  const finalResponserAgent = createFinalResponserAgent();

  // Mastra 인스턴스 생성
  const mastra = new Mastra({
    agents: {
      classifierAgent,
      finalResponserAgent,
      atlassianAgent,
      googleSearchAgent,
      dataHubAgent,
    },
    workflows: {
      chatWorkflow,
    },
    mcpServers,
    storage: new PostgresStore({
      id: "mastra",
      connectionString: process.env.DATABASE_URL,
    }),
    logger: new PinoLogger({
      name: "Mastra",
      level: "info",
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
        // Workflow 스트리밍 (useChat 호환)
        workflowRoute({
          path: "/chat",
          workflow: "chatWorkflow",
        }),
        // 대화 기록 조회 (향후 메모리 통합 예정)
        registerApiRoute("/chat-history", {
          method: "GET",
          handler: async (c) => {
            return c.json([]);
          },
        }),
      ],
    },
  });

  return {
    mastra,
    shutdown: disconnectMcp,
  };
}

const { mastra, shutdown } = await initializeMastra();

export { mastra, shutdown };
