import { MCPClient } from "@mastra/mcp";
import { resolve } from "path";

/**
 * MCP 클라이언트 설정 - 하이브리드 아키텍처
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
 * Atlassian/DataHub MCP 서버 설정을 환경에 따라 동적 생성
 * - MCP_*_URL 설정됨 → HTTP (K8s 배포)
 * - 서비스 URL만 설정됨 → stdio (로컬 개발)
 * - 아무것도 없음 → 스킵
 */
function buildServers(): Record<string, any> {
  const servers: Record<string, any> = {};

  // === Atlassian ===
  if (MCP_ATLASSIAN_URL) {
    // K8s: HTTP 연결
    servers.atlassian = {
      url: new URL(MCP_ATLASSIAN_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` },
        },
      }),
    };
  } else if (process.env.CONFLUENCE_URL) {
    // 로컬: stdio로 mcp-atlassian 실행
    servers.atlassian = {
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

  // === DataHub ===
  if (MCP_DATAHUB_URL) {
    // K8s: HTTP 연결
    servers.datahub = {
      url: new URL(MCP_DATAHUB_URL),
      ...(MCP_AUTH_TOKEN && {
        requestInit: {
          headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` },
        },
      }),
    };
  } else if (process.env.DATAHUB_GMS_URL) {
    // 로컬: stdio로 mcp-server-datahub 실행
    servers.datahub = {
      command: "uvx",
      args: ["mcp-server-datahub"],
      env: {
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL,
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN || "",
      },
    };
  }

  return servers;
}

/**
 * MCP 클라이언트 생성
 */
export const mcpClient = new MCPClient({
  id: "mmiai-mcp",
  servers: {
    ...buildServers(),

    // Google Search MCP 서버 (항상 stdio)
    "google-search": {
      command: "node",
      args: [resolve(process.cwd(), "google-search-mcp/google-search.js")],
      env: {
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
        GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID || "",
      },
    },
  },
  timeout: 60000,
});

/**
 * MCP 도구 가져오기
 * Agent 정의 시 사용 (Static Configuration)
 */
export async function getMcpTools() {
  return mcpClient.listTools();
}

/**
 * MCP 도구셋 가져오기
 * 요청마다 다른 설정이 필요할 때 사용 (Dynamic Configuration)
 */
export async function getMcpToolsets() {
  return mcpClient.listToolsets();
}

/**
 * MCP 클라이언트 연결 해제
 * 애플리케이션 종료 시 호출
 */
export async function disconnectMcp() {
  await mcpClient.disconnect();
}
