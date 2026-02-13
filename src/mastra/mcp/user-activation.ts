import { PostgresStore } from "@mastra/pg";
import { MCP_REGISTRY, getAllMcpIds } from "./mcp-registry";

/**
 * 사용자별 MCP 활성화 상태 관리
 *
 * PostgresStore.db를 사용하여 user_mcp_activations 테이블에 접근합니다.
 * Mastra의 기존 PostgresStore 연결을 재사용합니다.
 *
 * 기본 동작: 레코드가 없으면 모든 MCP 활성 (기존 동작 호환)
 */

let store: PostgresStore | null = null;
let initialized = false;

function getStore(): PostgresStore {
  if (!store) {
    store = new PostgresStore({
      id: "mcp-activations",
      connectionString: process.env.DATABASE_URL,
    });
  }
  return store;
}

/**
 * 테이블 초기화 (최초 1회)
 */
async function ensureTable(): Promise<void> {
  if (initialized) return;

  const s = getStore();
  await s.init();
  await s.db.none(`
    CREATE TABLE IF NOT EXISTS user_mcp_activations (
      user_id TEXT NOT NULL,
      mcp_id TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, mcp_id)
    )
  `);
  initialized = true;
}

/**
 * 사용자의 활성 MCP 서버 ID 목록을 반환합니다.
 *
 * 레코드가 없으면 모든 MCP를 활성으로 간주합니다 (기존 동작 호환).
 * 레코드가 있으면 active=true인 MCP만 반환합니다.
 */
export async function getUserActiveMcpIds(userId: string): Promise<string[]> {
  await ensureTable();

  const rows = await getStore().db.any(
    "SELECT mcp_id, active FROM user_mcp_activations WHERE user_id = $1",
    [userId],
  );

  // 레코드가 하나도 없으면 → 전체 활성 (기본값)
  if (rows.length === 0) {
    return getAllMcpIds();
  }

  // 레코드가 있으면 → active=true인 것만
  return rows
    .filter((row: { mcp_id: string; active: boolean }) => row.active)
    .map((row: { mcp_id: string; active: boolean }) => row.mcp_id);
}

/**
 * 사용자의 MCP 활성화 상태를 설정합니다.
 */
export async function setUserMcpActivation(
  userId: string,
  mcpId: string,
  active: boolean,
): Promise<void> {
  await ensureTable();

  // 레지스트리에 등록된 MCP만 허용
  if (!getAllMcpIds().includes(mcpId)) {
    throw new Error(`Unknown MCP server ID: ${mcpId}`);
  }

  await getStore().db.none(
    `INSERT INTO user_mcp_activations (user_id, mcp_id, active, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, mcp_id)
     DO UPDATE SET active = $3, updated_at = NOW()`,
    [userId, mcpId, active],
  );
}

/**
 * 사용자의 모든 MCP 서버 상태를 반환합니다 (설정 UI용).
 */
export async function getUserMcpStatuses(
  userId: string,
): Promise<
  Array<{ id: string; name: string; description: string; active: boolean }>
> {
  await ensureTable();

  const rows = await getStore().db.any(
    "SELECT mcp_id, active FROM user_mcp_activations WHERE user_id = $1",
    [userId],
  );

  const activationMap = new Map<string, boolean>();
  for (const row of rows as Array<{ mcp_id: string; active: boolean }>) {
    activationMap.set(row.mcp_id, row.active);
  }

  // 레지스트리 기준으로 전체 목록 생성 (미등록은 기본 활성)
  return MCP_REGISTRY.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    active: activationMap.get(entry.id) ?? true,
  }));
}
