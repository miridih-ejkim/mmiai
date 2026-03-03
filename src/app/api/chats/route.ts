import { NextRequest, NextResponse } from "next/server";
import { getChatsByUserId, createChat } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const list = await getChatsByUserId(userId);
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, userId, title } = body;
  if (!id || !userId) {
    return NextResponse.json(
      { error: "id and userId required" },
      { status: 400 },
    );
  }
  const chat = await createChat({ id, userId, title });
  return NextResponse.json(chat, { status: 201 });
}
