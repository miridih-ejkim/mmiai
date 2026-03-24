import { NextRequest, NextResponse } from "next/server";
import { getPptChatsByUserId } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const list = await getPptChatsByUserId(userId);
  return NextResponse.json(list);
}
