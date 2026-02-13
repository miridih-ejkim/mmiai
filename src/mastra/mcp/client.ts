/**
 * MCP 클라이언트 설정 - Legacy (참조용)
 *
 * 모든 builder 함수와 레지스트리는 mcp-registry.ts로 이전되었습니다.
 * 이 파일은 하위 호환을 위해 re-export합니다.
 */
export {
  buildAtlassianServer,
  buildDatahubServer,
  buildGoogleSearchServer,
} from "./mcp-registry";
