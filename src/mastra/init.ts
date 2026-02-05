import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { networkRoute } from "@mastra/ai-sdk";
import { registerApiRoute } from "@mastra/core/server";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";

import { mcpClient } from "./mcp/client";
import {
  createAtlassianAgent,
  createGoogleSearchAgent,
  createDataHubAgent,
} from "./agents/workers";

const THREAD_ID = "example-user-id";
const RESOURCE_ID = "coordinator-chat";

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
  // MCP 도구 로드
  const mcpTools = await mcpClient.listTools();

  // Worker Agents 생성 (MCP 도구 주입)
  const atlassianAgent = createAtlassianAgent(mcpTools);
  const googleSearchAgent = createGoogleSearchAgent(mcpTools);
  const dataHubAgent = createDataHubAgent(mcpTools);

  // Coordinator Agent 생성
  const coordinator = new Agent({
    id: "coordinator",
    name: "Coordinator",
    instructions: `
      당신은 사용자 요청을 분석하고 적절한 전문 에이전트에게 위임하는 조율자입니다.

      ## 사용 가능한 에이전트

      ### atlassianAgent (Confluence + Jira)
      - Confluence 문서 검색 및 조회
      - Confluence 페이지 하위 페이지, 댓글, 레이블 조회
      - Jira 이슈 검색 및 상세 조회
      - Jira 프로젝트, 스프린트, 보드 정보 조회
      - 사용자 프로필 조회

      ### googleSearchAgent (웹 검색)
      - Google 웹 검색
      - 최신 뉴스 및 정보 조회
      - 웹페이지 콘텐츠 추출 및 요약
      - 여러 웹페이지 비교 분석

      ### dataHubAgent (데이터 카탈로그)
      - DataHub 데이터 자산 검색
      - 데이터셋 스키마 및 메타데이터 조회
      - 데이터 리니지(계보) 분석
      - 데이터 도메인/태그 조회

      ## 라우팅 가이드라인

      ### atlassianAgent 사용
      - "Confluence에서 ~" 또는 문서/페이지 관련 질문
      - "Jira에서 ~" 또는 이슈/티켓 관련 질문
      - 사내 문서, 위키, 프로젝트 관리 관련 요청
      - 회의록, 정책, 가이드 문서 검색

      ### googleSearchAgent 사용
      - 외부 정보, 최신 뉴스 검색
      - "최신", "최근", "뉴스" 키워드 포함 질문
      - 특정 URL 내용 확인/요약 요청
      - 일반 지식 질문 (사내 정보가 아닌 경우)

      ### dataHubAgent 사용
      - **명시적인 데이터 관련 질문에만 사용**
      - "테이블", "데이터셋", "스키마" 관련 질문
      - "리니지", "lineage", "데이터 계보" 관련 질문
      - 데이터 도메인, 태그 관련 조회
      - **일반 비즈니스 질문에는 사용 금지**

      ## 작업 처리 원칙
      1. 사용자 요청을 분석하여 가장 적합한 에이전트 결정
      2. 단순 작업: 해당 에이전트 1회 호출
      3. 복합 작업: 여러 에이전트를 순차적으로 호출
      4. 각 에이전트 결과를 통합하여 최종 응답 생성

      ## 주의사항
      - 직접 작업하지 말고, 반드시 적절한 에이전트를 호출하세요
      - 에이전트 호출 시 명확한 지시사항을 전달하세요
      - 결과를 사용자가 이해하기 쉽게 정리하세요
      - 모호한 요청은 사용자에게 명확히 질문하세요
    `,
    model: "anthropic/claude-sonnet-4-5",
    agents: { atlassianAgent, googleSearchAgent, dataHubAgent },
    memory: new Memory(),
  });

  // Mastra 인스턴스 생성
  const mastra = new Mastra({
    agents: {
      coordinator,
      atlassianAgent,
      googleSearchAgent,
      dataHubAgent,
    },
    storage: new LibSQLStore({
      id: "mastra-storage",
      url: ":memory:",
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
        // Agent Network 스트리밍 (useChat 호환)
        networkRoute({
          path: "/chat",
          agent: "coordinator",
        }),
        // 대화 기록 조회
        registerApiRoute("/chat-history", {
          method: "GET",
          handler: async (c) => {
            const mastra = c.get("mastra");
            const memory = await mastra.getAgent("coordinator").getMemory();
            let response = null;
            try {
              response = await memory?.recall({
                threadId: THREAD_ID,
                resourceId: RESOURCE_ID,
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
    shutdown: () => mcpClient.disconnect(),
  };
}
