import { MCPClient } from "@mastra/mcp";
import type { MastraMCPServerDefinition } from "@mastra/mcp";
import { resolve, dirname } from "path";
import { existsSync } from "fs";

/**
 * MCP 클라이언트 설정 - 서비스별 분리 구성
 *
 * 연결 방식 (환경에 따라 자동 선택):
 *
 * [로컬 개발] stdio 모드
 * - Atlassian: uvx mcp-atlassian (CONFLUENCE_URL 등 설정 시)
 * - DataHub: uvx mcp-server-datahub (DATAHUB_GMS_URL 설정 시)
 * - Google Search: node google-search-mcp/google-search.js
 *
 * [K8s 배포] HTTP 모드
 * - Atlassian: MCP_ATLASSIAN_URL 설정 시 HTTP 연결
 * - DataHub: MCP_DATAHUB_URL 설정 시 HTTP 연결
 * - Google Search: stdio (동일)
 */

// HTTP MCP 서버 URL (K8s 배포 시 설정)
const MCP_ATLASSIAN_URL = process.env.MCP_ATLASSIAN_URL;
const MCP_DATAHUB_URL = process.env.MCP_DATAHUB_URL;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/**
 * 프로젝트 루트 경로 계산
 *
 * mastra dev/build 시 process.cwd()가 달라질 수 있음:
 * - .mastra/output/ (빌드 출력 디렉토리)
 * - src/mastra/public/ (dev 서버 정적 파일 디렉토리)
 *
 * cwd에서 위로 올라가며 package.json을 찾아 프로젝트 루트를 결정합니다.
 * .mastra/ 내부의 package.json은 무시합니다.
 */
function resolveProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (!dir.includes("/.mastra/") && existsSync(resolve(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function buildAtlassianServer(): MastraMCPServerDefinition | null {
  if (MCP_ATLASSIAN_URL) {
    return {
      url: new URL(MCP_ATLASSIAN_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: { headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` } },
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

function buildDatahubServer(): MastraMCPServerDefinition | null {
  if (MCP_DATAHUB_URL) {
    return {
      url: new URL(MCP_DATAHUB_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: { headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` } },
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

// === 서비스별 MCPClient ===

export const atlassianMcpClient = (() => {
  const server = buildAtlassianServer();
  if (!server) return null;
  return new MCPClient({
    id: "atlassian-mcp",
    servers: { atlassian: server },
    timeout: 60000,
  });
})();

export const datahubMcpClient = (() => {
  const server = buildDatahubServer();
  if (!server) return null;
  return new MCPClient({
    id: "datahub-mcp",
    servers: { datahub: server },
    timeout: 60000,
  });
})();

export const googleSearchMcpClient = new MCPClient({
  id: "google-search-mcp",
  servers: {
    "google-search": {
      command: "node",
      args: [resolve(resolveProjectRoot(), "google-search-mcp/google-search.js")],
      env: {
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
        GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID || "",
      },
    },
  },
  timeout: 60000,
});

/**
 * 모든 MCP 클라이언트 연결 해제
 */
export async function disconnectMcp() {
  await Promise.allSettled([
    atlassianMcpClient?.disconnect(),
    datahubMcpClient?.disconnect(),
    googleSearchMcpClient.disconnect(),
  ]);
}
