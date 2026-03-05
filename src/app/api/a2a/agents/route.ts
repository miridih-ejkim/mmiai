import { NextResponse } from "next/server";
import { getAvailableA2AAgents } from "@/mastra/a2a/a2a-registry";
import { fetchAgentCard, fetchAgentIds } from "@/mastra/a2a/a2a-client";

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
          id: agent.agentId,
          name: agent.name,
          description: agent.description,
          version: agent.version,
          provider: agent.provider,
          capabilities: agent.capabilities,
          skills: agent.skills || [],
          // 라우팅용 (spec 외)
          source: "external" as const,
          baseUrl: agent.baseUrl,
          serverId: agent.serverId,
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
  const allIds = await fetchAgentIds(MASTRA_URL);
  const a2aIds = allIds.filter((id) => id.startsWith("a2a"));

  const cards = await Promise.all(
    a2aIds.map(async (id) => {
      const card = await fetchAgentCard(MASTRA_URL, id);
      if (!card) return null;
      return { ...card, id, source: "local" as const };
    }),
  );

  return cards.filter(Boolean);
}
