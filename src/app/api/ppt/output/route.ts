import { NextRequest, NextResponse } from "next/server";
import { getLatestPptOutput } from "@/lib/db/queries";

/**
 * GET /api/ppt/output?chatId=xxx
 *
 * 특정 PPT 스레드의 최신 HTML 출력물을 반환한다.
 */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const output = await getLatestPptOutput(chatId);
  if (!output) {
    return NextResponse.json({ html: null });
  }

  return NextResponse.json({
    html: output.html,
    version: output.version,
    prompt: output.prompt,
  });
}
