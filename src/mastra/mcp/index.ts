/**
 * MCP 모듈 진입점
 *
 * Lazy MCP Loading 아키텍처:
 * - 서버 시작 시 MCP 연결 없음
 * - 요청 시점에 McpConnectionManager가 필요한 MCP만 lazy connect
 * - 사용자별 활성화 상태는 PostgreSQL로 관리
 */
export { mcpConnectionManager } from "./connection-manager";
export {
  MCP_REGISTRY,
  getRegistryEntry,
  getAllMcpIds,
  type McpServerRegistryEntry,
} from "./mcp-registry";
export {
  getUserActiveMcpIds,
  setUserMcpActivation,
  getUserMcpStatuses,
} from "./user-activation";
