import { NextResponse } from "next/server";
import {
  registerA2AServer,
  removeA2AServer,
  getA2AServers,
  setA2AServerActive,
} from "@/mastra/a2a/a2a-registry";

/**
 * GET /api/a2a/servers — 등록된 서버 + 발견된 Agent 목록
 */
export async function GET() {
  try {
    const servers = await getA2AServers();
    return NextResponse.json(servers);
  } catch (error) {
    console.error("[A2A Servers] GET error:", error);
    return NextResponse.json(
      { error: "서버 목록을 가져올 수 없습니다." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/a2a/servers — 서버 등록 + Agent Discovery
 *
 * Body: { id, name, baseUrl }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, name, baseUrl } = body;

    if (!id || !name || !baseUrl) {
      return NextResponse.json(
        { error: "id, name, baseUrl are required" },
        { status: 400 },
      );
    }

    // ID 형식 검증 (alphanumeric + hyphen)
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json(
        { error: "id는 영문, 숫자, 하이픈만 허용합니다." },
        { status: 400 },
      );
    }

    const result = await registerA2AServer(id, name, baseUrl);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[A2A Servers] POST error:", error);
    return NextResponse.json(
      {
        error: `서버 등록 실패: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/a2a/servers — 서버 삭제
 *
 * Body: { id }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 },
      );
    }

    await removeA2AServer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[A2A Servers] DELETE error:", error);
    return NextResponse.json(
      { error: "서버 삭제 실패" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/a2a/servers — 서버 활성/비활성 토글
 *
 * Body: { id, active }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, active } = body;

    if (!id || active === undefined) {
      return NextResponse.json(
        { error: "id, active are required" },
        { status: 400 },
      );
    }

    await setA2AServerActive(id, active);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[A2A Servers] PATCH error:", error);
    return NextResponse.json(
      { error: "상태 변경 실패" },
      { status: 500 },
    );
  }
}
