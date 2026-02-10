// top-level await (ESM)
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";

import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
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
 * Deterministic Workflow + HITL 구조:
 * - Step 1: Classifier Agent (Haiku) → 의도 분류 (structured output)
 * - .branch(): 분류 결과에 따라 결정적 분기
 *   - simple → 직접 응답
 *   - single-agent → 해당 Worker Agent 호출
 *   - multi-agent → .parallel() 병렬 실행 + merge
 * - .map(): 출력 정규화
 * - Quality Check: Scorer 기반 품질 평가 → 실패 시 suspend (HITL)
 * - Final: Final Responser Agent (Haiku) → 응답 합성
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
        // Chat Workflow (suspend/resume 지원 커스텀 라우트)
        registerApiRoute("/chat", {
          method: "POST",
          handler: async (c) => {
            const body = await c.req.json();
            const workflow = mastra.getWorkflow("chatWorkflow");

            let result: any;

            if (body.runId && body.resumeData) {
              // === Resume: suspend된 워크플로우 재개 ===
              const run = await workflow.createRun({ runId: body.runId });
              result = await run.resume({
                step: "quality-check",
                resumeData: body.resumeData,
              });
            } else {
              // === New: 새 워크플로우 실행 ===
              const run = await workflow.createRun();
              result = await run.start({
                inputData: body.inputData || { message: body.message || "" },
              });
            }

            // Suspended → 사용자 피드백 요청
            if (result.status === "suspended") {
              const suspendPayload =
                result.steps?.["quality-check"]?.suspendPayload as
                  | { reason?: string; score?: number; originalSource?: string }
                  | undefined;
              return c.json({
                status: "suspended",
                runId: result.runId,
                reason: suspendPayload?.reason || "품질 검증 실패",
                score: suspendPayload?.score ?? 0,
                originalSource: suspendPayload?.originalSource || "unknown",
              });
            }

            // Completed → 응답 반환
            return c.json({
              status: "completed",
              response: result.result?.response || "",
            });
          },
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
