import { NextResponse } from "next/server";
import { discoverAgents } from "@/mastra/a2a/a2a-registry";

/**
 * POST /api/a2a/servers/{serverId}/discover — Agent 재검색 (수동 refresh)
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  try {
    const { serverId } = await params;
    const agents = await discoverAgents(serverId);
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("[A2A Discover] error:", error);
    return NextResponse.json(
      {
        error: `Agent 검색 실패: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}
