import { and, desc, eq } from "drizzle-orm";
import { db } from ".";
import { chats, messages, pptOutputs } from "./schema";

// ── Chats ──

export async function getChatsByUserId(userId: string) {
  return db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), eq(chats.type, "chat")))
    .orderBy(desc(chats.createdAt));
}

export async function getPptChatsByUserId(userId: string) {
  return db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), eq(chats.type, "ppt")))
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
  type = "chat",
}: {
  id: string;
  userId: string;
  title?: string;
  type?: "chat" | "ppt";
}) {
  const [chat] = await db
    .insert(chats)
    .values({ id, userId, title: title ?? "New Chat", type })
    .returning();
  return chat;
}

export async function updateChatTitle(chatId: string, title: string) {
  await db.update(chats).set({ title }).where(eq(chats.id, chatId));
}

export async function updateChatSuspendMeta(
  chatId: string,
  suspendMeta: { runId: string; suspendedStep: string[] | string; hitlType: string } | null,
) {
  await db.update(chats).set({ suspendMeta }).where(eq(chats.id, chatId));
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

// ── PPT Outputs ──

/** 특정 스레드의 최신 PPT 출력물 조회 */
export async function getLatestPptOutput(chatId: string) {
  const [output] = await db
    .select()
    .from(pptOutputs)
    .where(eq(pptOutputs.chatId, chatId))
    .orderBy(desc(pptOutputs.createdAt))
    .limit(1);
  return output ?? null;
}

/** PPT 출력물 저장 (새 버전 추가) */
export async function savePptOutput({
  id,
  chatId,
  html,
  version,
  prompt,
}: {
  id: string;
  chatId: string;
  html: string;
  version: number;
  prompt?: string;
}) {
  const [output] = await db
    .insert(pptOutputs)
    .values({
      id,
      chatId,
      html,
      version: String(version),
      prompt,
    })
    .returning();
  return output;
}

/** 특정 스레드의 PPT 버전 이력 조회 */
export async function getPptOutputHistory(chatId: string) {
  return db
    .select({
      id: pptOutputs.id,
      version: pptOutputs.version,
      prompt: pptOutputs.prompt,
      createdAt: pptOutputs.createdAt,
    })
    .from(pptOutputs)
    .where(eq(pptOutputs.chatId, chatId))
    .orderBy(desc(pptOutputs.createdAt));
}
