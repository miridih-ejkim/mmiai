import type { MastraMCPServerDefinition } from "@mastra/mcp";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

/**
 * MCP 서버 레지스트리 엔트리
 *
 * 관리자가 승인한 MCP 서버의 연결 설정, 메타데이터, Agent 매핑을 정의합니다.
 * 사용자는 이 풀 안에서만 MCP 서버를 on/off 할 수 있습니다.
 */
export interface McpServerRegistryEntry {
  /** 고유 ID (e.g., "atlassian", "google-search", "datahub") */
  id: string;
  /** UI 표시명 */
  name: string;
  /** classifier에 전달할 설명 (이 MCP 서버가 어떤 질문을 처리하는지) */
  description: string;
  /** Mastra Agent ID (e.g., "atlassianAgent") */
  agentId: string;
  /** classifier의 type enum 값 (e.g., "atlassian") */
  classifierType: string;
  /** MCPClient 연결 설정 팩토리 (null이면 환경 미설정으로 사용 불가) */
  buildServerDef: () => MastraMCPServerDefinition | null;
  /** DataHub 등 재귀 JSON Schema 문제로 fallback 도구가 필요한 경우 */
  requiresFallback?: boolean;
  /** 다른 MCP의 연결을 재사용할 때 (예: data-analyst → datahub) */
  mcpId?: string;
}

// --- 환경변수 ---
const MCP_ATLASSIAN_URL = process.env.MCP_ATLASSIAN_URL;
const MCP_DATAHUB_URL = process.env.MCP_DATAHUB_URL;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/**
 * 프로젝트 루트 경로 계산
 *
 * mastra dev/build 시 process.cwd()가 .mastra/ 하위일 수 있으므로
 * 위로 올라가며 package.json을 찾아 실제 프로젝트 루트를 결정합니다.
 */
function resolveProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (
      !dir.includes("/.mastra/") &&
      existsSync(resolve(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// --- 서비스별 연결 설정 빌더 ---

export function buildAtlassianServer(): MastraMCPServerDefinition | null {
  if (MCP_ATLASSIAN_URL) {
    return {
      url: new URL(MCP_ATLASSIAN_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` },
        },
      }),
    };
  }
  if (process.env.CONFLUENCE_URL) {
    return {
      command: "uvx",
      args: ["mcp-atlassian"],
      env: {
        CONFLUENCE_URL: process.env.CONFLUENCE_URL,
        CONFLUENCE_USERNAME: process.env.CONFLUENCE_USERNAME || "",
        CONFLUENCE_API_TOKEN: process.env.CONFLUENCE_API_TOKEN || "",
        JIRA_URL: process.env.JIRA_URL || "",
        JIRA_USERNAME: process.env.JIRA_USERNAME || "",
        JIRA_API_TOKEN: process.env.JIRA_API_TOKEN || "",
      },
    };
  }
  return null;
}

export function buildDatahubServer(): MastraMCPServerDefinition | null {
  if (MCP_DATAHUB_URL) {
    return {
      url: new URL(MCP_DATAHUB_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` },
        },
      }),
    };
  }
  if (process.env.DATAHUB_GMS_URL) {
    return {
      command: "uvx",
      args: ["mcp-server-datahub"],
      env: {
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL,
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN || "",
      },
    };
  }
  return null;
}

export function buildGoogleSearchServer(): MastraMCPServerDefinition {
  return {
    command: "node",
    args: [
      resolve(resolveProjectRoot(), "google-search-mcp/google-search.js"),
    ],
    env: {
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID || "",
    },
  };
}

// --- 레지스트리 ---

export const MCP_REGISTRY: McpServerRegistryEntry[] = [
  {
    id: "atlassian",
    name: "Atlassian (Confluence/Jira)",
    description:
      "Confluence documents, Jira issues, internal wikis, meeting notes, policy documents. Keywords: 문서, 위키, 회의록, Jira, 이슈, 티켓, 스프린트, Confluence",
    agentId: "atlassianAgent",
    classifierType: "atlassian",
    buildServerDef: buildAtlassianServer,
  },
  {
    id: "google-search",
    name: "Google Search",
    description:
      "Web search, latest news, URL content extraction. Keywords: 최신, 최근, 뉴스, 검색, 트렌드, latest, news, URL",
    agentId: "googleSearchAgent",
    classifierType: "google-search",
    buildServerDef: buildGoogleSearchServer,
  },
  {
    id: "datahub",
    name: "DataHub",
    description:
      "Data catalog exploration: table search, schema inspection, lineage. Keywords: 테이블, 데이터셋, 스키마, 리니지, lineage, 메타데이터. Use alone for simple metadata questions. For analysis+dashboard requests, use with data-analyst in sequential mode.",
    agentId: "dataHubAgent",
    classifierType: "datahub",
    buildServerDef: buildDatahubServer,
    requiresFallback: true,
  },
  {
    id: "data-analyst",
    name: "Data Analyst (Shaper Dashboard)",
    description:
      "DuckDB SQL dashboard creation via Shaper. Receives data exploration results from previous steps and creates visual dashboards. Keywords: 대시보드, dashboard, 시각화, 분석, DuckDB, SQL, 차트, 리포트. Always used AFTER datahub in sequential mode.",
    agentId: "dataAnalystAgent",
    classifierType: "data-analyst",
    buildServerDef: () => null,
  },
];

/** ID로 레지스트리 엔트리 조회 */
export function getRegistryEntry(
  id: string,
): McpServerRegistryEntry | undefined {
  return MCP_REGISTRY.find((entry) => entry.id === id);
}

/** 전체 MCP ID 목록 */
export function getAllMcpIds(): string[] {
  return MCP_REGISTRY.map((entry) => entry.id);
}
