import { desc, eq } from "drizzle-orm";
import { db } from ".";
import { chats, messages } from "./schema";

// ── Chats ──

export async function getChatsByUserId(userId: string) {
  return db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.createdAt));
}

export async function getChatById(chatId: string) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  return chat ?? null;
}

export async function createChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title?: string;
}) {
  const [chat] = await db
    .insert(chats)
    .values({ id, userId, title: title ?? "New Chat" })
    .returning();
  return chat;
}

export async function updateChatTitle(chatId: string, title: string) {
  await db.update(chats).set({ title }).where(eq(chats.id, chatId));
}

export async function deleteChat(chatId: string) {
  await db.delete(chats).where(eq(chats.id, chatId));
}

// ── Messages ──

export async function getMessagesByChatId(chatId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.createdAt);
}

export async function saveMessages(
  msgs: Array<{
    id: string;
    chatId: string;
    role: string;
    parts: unknown;
    createdAt?: Date;
  }>,
) {
  if (msgs.length === 0) return;
  await db
    .insert(messages)
    .values(
      msgs.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt ?? new Date(),
      })),
    )
    .onConflictDoNothing();
}
