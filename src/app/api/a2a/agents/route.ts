import { NextResponse } from "next/server";
import { getAvailableA2AAgents } from "@/mastra/a2a/a2a-registry";

const MASTRA_URL =
  process.env.MASTRA_SERVER_URL || "http://localhost:4111";

/**
 * A2A Agent 목록 API
 *
 * 로컬 Mastra 서버의 A2A Agent + 외부 서버의 Discovered Agent를 합쳐서 반환합니다.
 */
export async function GET() {
  try {
    // 1. 로컬 A2A agents — AgentCard 수집
    const localCards = await fetchLocalAgentCards();

    // 2. 외부 서버의 discovered agents
    let externalCards: any[] = [];
    try {
      const externalAgents = await getAvailableA2AAgents();
      externalCards = externalAgents
        .filter((a) => a.source === "external")
        .map((agent) => ({
          name: agent.name,
          description: agent.description,
          skills: [],
          _meta: {
            serverId: agent.serverId,
            agentId: agent.agentId,
            baseUrl: agent.baseUrl,
            source: "external",
          },
        }));
    } catch (e) {
      console.error("[A2A API] External agents fetch error:", e);
    }

    return NextResponse.json([...localCards, ...externalCards]);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Mastra 서버 연결 실패: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 502 },
    );
  }
}

/**
 * 로컬 Mastra 서버에서 A2A AgentCard 수집
 */
async function fetchLocalAgentCards() {
  const url = `${MASTRA_URL}/api/agents`;
  const agentsRes = await fetch(url, { cache: "no-store" });

  if (!agentsRes.ok) {
    console.error(`[A2A API] Mastra agents fetch failed: ${agentsRes.status}`);
    return [];
  }

  const agents = await agentsRes.json();
  const a2aAgentIds = Object.keys(agents).filter((id) =>
    id.startsWith("a2a"),
  );

  const cards = await Promise.all(
    a2aAgentIds.map(async (id) => {
      try {
        const cardUrl = `${MASTRA_URL}/api/.well-known/${id}/agent-card.json`;
        const res = await fetch(cardUrl, { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }),
  );

  return cards.filter(Boolean);
}
