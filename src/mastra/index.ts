// top-level await (ESM)
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";

import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { chatRoute } from "@mastra/ai-sdk";
import { registerApiRoute } from "@mastra/core/server";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";

import { mcpServers, mcpToolsByService, disconnectMcp } from "./mcp";
import {
  createAtlassianAgent,
  createGoogleSearchAgent,
  createDataHubAgent,
} from "./agents/workers";
import { currentTimeTool } from "./tools/current-time";
import { createSupervisorAgent } from "./agents/supervisor";

// 기본 Thread/Resource ID (chatRoute와 chat-history 라우트에서 공유)
const DEFAULT_THREAD_ID = "default-thread";
const DEFAULT_RESOURCE_ID = "default-user";

/**
 * Mastra 인스턴스 비동기 초기화
 *
 * MCP 도구를 로드하고 Agent를 생성합니다.
 * 서버 시작 시 한 번만 호출됩니다.
 */
export async function initializeMastra(): Promise<{
  mastra: Mastra;
  shutdown: () => Promise<void>;
}> {
  // Worker Agents 생성 (서비스별 MCP 도구 주입)
  const atlassianAgent = createAtlassianAgent(mcpToolsByService.atlassian);
  const googleSearchAgent = createGoogleSearchAgent(mcpToolsByService.googleSearch);
  const dataHubAgent = createDataHubAgent(mcpToolsByService.datahub);

  // Supervisor Agent 생성 (페르소나 + 라우팅 통합)
  const supervisorAgent = createSupervisorAgent({
    tools: { "get-current-datetime": currentTimeTool },
    agents: { atlassianAgent, googleSearchAgent, dataHubAgent },
  });

  // Mastra 인스턴스 생성
  const mastra = new Mastra({
    agents: {
      supervisorAgent,
      atlassianAgent,
      googleSearchAgent,
      dataHubAgent,
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
          exporters: [new DefaultExporter(), new CloudExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    }),
    server: {
      apiRoutes: [
        // Coordinator Agent Network (메인 채팅, useChat 호환)
        chatRoute({
          path: "/chat",
          agent: "supervisor",
          defaultOptions: {
            memory: {
              thread: DEFAULT_THREAD_ID,
              resource: DEFAULT_RESOURCE_ID,
            },
          },
        }),
        // 대화 기록 조회
        registerApiRoute("/chat-history", {
          method: "GET",
          handler: async (c) => {
            const mastra = c.get("mastra");
            const memory = await mastra.getAgent("supervisor").getMemory();
            let response = null;
            try {
              response = await memory?.recall({
                threadId: DEFAULT_THREAD_ID,
                resourceId: DEFAULT_RESOURCE_ID,
              });
            } catch {
              // No previous messages
            }
            const uiMessages = toAISdkV5Messages(response?.messages || []);
            return c.json(uiMessages);
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
