import { mcpConnectionManager } from "../mcp";

/**
 * toolsets 이중 중첩 → flat Record<string, ToolAction>
 *
 * mcpConnectionManager.getToolsets()는 { serverName: { toolName: tool } } 이중 중첩을 반환합니다.
 * Agent의 tools에는 { toolName: tool } 평탄 구조가 필요합니다.
 */
export function flattenToolsets(
  toolsets: Record<string, any>,
): Record<string, any> {
  return Object.values(toolsets).reduce(
    (acc, ts) => ({ ...acc, ...(ts as Record<string, unknown>) }),
    {},
  );
}

/**
 * MCP ID로 flat tools 반환 (Agent tools 동적 함수용)
 *
 * 사용법:
 * ```
 * new Agent({
 *   tools: async () => getMcpTools("atlassian"),
 * })
 * ```
 */
export async function getMcpTools(
  mcpId: string,
): Promise<Record<string, any>> {
  const toolsets = await mcpConnectionManager.getToolsets(mcpId);
  return flattenToolsets(toolsets);
}
