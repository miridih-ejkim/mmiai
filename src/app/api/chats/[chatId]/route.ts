import { NextRequest, NextResponse } from "next/server";
import { getChatById, deleteChat } from "@/lib/db/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  const chat = await getChatById(chatId);
  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(chat);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  await deleteChat(chatId);
  return NextResponse.json({ success: true });
}
