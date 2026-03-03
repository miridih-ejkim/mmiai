import { NextRequest, NextResponse } from "next/server";
import { getMessagesByChatId } from "@/lib/db/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  const msgs = await getMessagesByChatId(chatId);
  return NextResponse.json(msgs);
}
