import { PostgresStore } from "@mastra/pg";

/**
 * A2A Server Registry
 *
 * 외부 A2A 서버를 등록하고 AgentCard를 자동 수집(Discovery)합니다.
 * user-activation.ts 패턴 재사용 (PostgresStore + lazy ensureTable).
 */

let store: PostgresStore | null = null;
let initialized = false;

function getStore(): PostgresStore {
  if (!store) {
    store = new PostgresStore({
      id: "a2a-registry",
      connectionString: process.env.DATABASE_URL,
    });
  }
  return store;
}

async function ensureTable(): Promise<void> {
  if (initialized) return;

  const s = getStore();
  await s.init();

  // 등록된 외부 A2A 서버
  await s.db.none(`
    CREATE TABLE IF NOT EXISTS a2a_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 발견된 Agent 캐시
  await s.db.none(`
    CREATE TABLE IF NOT EXISTS a2a_discovered_agents (
      server_id TEXT NOT NULL REFERENCES a2a_servers(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      skills TEXT,
      discovered_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (server_id, agent_id)
    )
  `);

  initialized = true;
}

// ── Types ──

export interface A2AServer {
  id: string;
  name: string;
  base_url: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface A2ADiscoveredAgent {
  server_id: string;
  agent_id: string;
  name: string;
  description: string | null;
  skills: string | null;
  discovered_at: string;
}

export interface A2AServerWithAgents extends A2AServer {
  agents: A2ADiscoveredAgent[];
}

// ── CRUD ──

/**
 * 서버 등록 + Agent Discovery 실행
 */
export async function registerA2AServer(
  id: string,
  name: string,
  baseUrl: string,
): Promise<{ server: A2AServer; discoveredAgents: A2ADiscoveredAgent[] }> {
  await ensureTable();

  await getStore().db.none(
    `INSERT INTO a2a_servers (id, name, base_url, active, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (id)
     DO UPDATE SET name = $2, base_url = $3, updated_at = NOW()`,
    [id, name, baseUrl],
  );

  const server = await getA2AServer(id);
  const discoveredAgents = await discoverAgents(id);

  return { server: server!, discoveredAgents };
}

/**
 * 서버 삭제 (CASCADE로 discovered_agents도 삭제)
 */
export async function removeA2AServer(id: string): Promise<void> {
  await ensureTable();
  await getStore().db.none("DELETE FROM a2a_servers WHERE id = $1", [id]);
}

/**
 * 단일 서버 조회
 */
export async function getA2AServer(
  id: string,
): Promise<A2AServer | null> {
  await ensureTable();
  const rows = await getStore().db.any(
    "SELECT * FROM a2a_servers WHERE id = $1",
    [id],
  );
  return (rows[0] as A2AServer) || null;
}

/**
 * 전체 서버 목록 (+ 발견된 Agent 포함)
 */
export async function getA2AServers(): Promise<A2AServerWithAgents[]> {
  await ensureTable();

  const servers = (await getStore().db.any(
    "SELECT * FROM a2a_servers ORDER BY created_at DESC",
  )) as A2AServer[];

  const agents = (await getStore().db.any(
    "SELECT * FROM a2a_discovered_agents ORDER BY agent_id",
  )) as A2ADiscoveredAgent[];

  const agentsByServer = new Map<string, A2ADiscoveredAgent[]>();
  for (const agent of agents) {
    const list = agentsByServer.get(agent.server_id) || [];
    list.push(agent);
    agentsByServer.set(agent.server_id, list);
  }

  return servers.map((server) => ({
    ...server,
    agents: agentsByServer.get(server.id) || [],
  }));
}

/**
 * 서버 활성/비활성 토글
 */
export async function setA2AServerActive(
  id: string,
  active: boolean,
): Promise<void> {
  await ensureTable();
  await getStore().db.none(
    "UPDATE a2a_servers SET active = $2, updated_at = NOW() WHERE id = $1",
    [id, active],
  );
}

// ── Discovery ──

/**
 * 서버에서 A2A Agent를 발견하여 DB에 캐시
 *
 * 1. GET {baseUrl}/api/agents → agent ID 목록
 * 2. 각 agent의 GET {baseUrl}/api/.well-known/{agentId}/agent-card.json
 * 3. AgentCard에서 name, description, skills 추출
 * 4. a2a_discovered_agents 테이블에 upsert
 */
export async function discoverAgents(
  serverId: string,
): Promise<A2ADiscoveredAgent[]> {
  await ensureTable();

  const server = await getA2AServer(serverId);
  if (!server) throw new Error(`Server not found: ${serverId}`);

  const baseUrl = server.base_url.replace(/\/$/, "");
  const discovered: A2ADiscoveredAgent[] = [];

  try {
    // 1. Agent 목록 조회
    const agentsRes = await fetch(`${baseUrl}/api/agents`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!agentsRes.ok) {
      console.error(
        `[A2A Registry] Failed to fetch agents from ${baseUrl}: ${agentsRes.status}`,
      );
      return [];
    }

    const agentsData = await agentsRes.json();
    const agentIds = Object.keys(agentsData);

    // 2. 각 agent의 AgentCard 수집
    const oldAgents = await getStore().db.any(
      "SELECT agent_id FROM a2a_discovered_agents WHERE server_id = $1",
      [serverId],
    );
    const oldIds = new Set(
      (oldAgents as { agent_id: string }[]).map((a) => a.agent_id),
    );

    for (const agentId of agentIds) {
      try {
        const cardRes = await fetch(
          `${baseUrl}/api/.well-known/${agentId}/agent-card.json`,
          { cache: "no-store", signal: AbortSignal.timeout(5000) },
        );
        if (!cardRes.ok) continue;

        const card = await cardRes.json();
        const agent: A2ADiscoveredAgent = {
          server_id: serverId,
          agent_id: agentId,
          name: card.name || agentId,
          description: card.description || null,
          skills: card.skills ? JSON.stringify(card.skills) : null,
          discovered_at: new Date().toISOString(),
        };

        // Upsert
        await getStore().db.none(
          `INSERT INTO a2a_discovered_agents (server_id, agent_id, name, description, skills, discovered_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (server_id, agent_id)
           DO UPDATE SET name = $3, description = $4, skills = $5, discovered_at = NOW()`,
          [serverId, agentId, agent.name, agent.description, agent.skills],
        );

        oldIds.delete(agentId);
        discovered.push(agent);
      } catch (e) {
        console.error(
          `[A2A Registry] Failed to fetch card for ${agentId}:`,
          e,
        );
      }
    }

    // 더 이상 존재하지 않는 agent 제거
    for (const removedId of oldIds) {
      await getStore().db.none(
        "DELETE FROM a2a_discovered_agents WHERE server_id = $1 AND agent_id = $2",
        [serverId, removedId],
      );
    }
  } catch (e) {
    console.error(`[A2A Registry] Discovery failed for ${serverId}:`, e);
  }

  return discovered;
}

// ── Supervisor용: 모든 활성 Agent 목록 ──

export interface AvailableA2AAgent {
  agentId: string;
  name: string;
  description: string;
  source: "local" | "external";
  baseUrl?: string;
  serverId?: string;
}

/**
 * 활성 서버의 모든 discovered agent + 로컬 A2A agent를 합쳐서 반환
 */
export async function getAvailableA2AAgents(): Promise<AvailableA2AAgent[]> {
  await ensureTable();

  const MASTRA_URL =
    process.env.MASTRA_SERVER_URL || "http://localhost:4111";

  const result: AvailableA2AAgent[] = [];

  // 1. 로컬 A2A agents
  try {
    const agentsRes = await fetch(`${MASTRA_URL}/api/agents`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (agentsRes.ok) {
      const agents = await agentsRes.json();
      const a2aIds = Object.keys(agents).filter((id) =>
        id.startsWith("a2a"),
      );
      for (const id of a2aIds) {
        try {
          const cardRes = await fetch(
            `${MASTRA_URL}/api/.well-known/${id}/agent-card.json`,
            { cache: "no-store", signal: AbortSignal.timeout(3000) },
          );
          if (cardRes.ok) {
            const card = await cardRes.json();
            result.push({
              agentId: id,
              name: card.name || id,
              description: card.description || "",
              source: "local",
            });
          }
        } catch {
          // skip individual card errors
        }
      }
    }
  } catch {
    console.error("[A2A Registry] Failed to fetch local agents");
  }

  // 2. 외부 서버의 discovered agents (활성 서버만)
  const rows = (await getStore().db.any(
    `SELECT a.*, s.base_url
     FROM a2a_discovered_agents a
     JOIN a2a_servers s ON s.id = a.server_id
     WHERE s.active = true
     ORDER BY a.agent_id`,
  )) as (A2ADiscoveredAgent & { base_url: string })[];

  for (const row of rows) {
    result.push({
      agentId: row.agent_id,
      name: row.name,
      description: row.description || "",
      source: "external",
      baseUrl: row.base_url,
      serverId: row.server_id,
    });
  }

  return result;
}
