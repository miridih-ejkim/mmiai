import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull().default("New Chat"),
  /** 'chat' | 'ppt' — 채팅 유형 구분 */
  type: text("type").notNull().default("chat"),
  suspendMeta: json("suspend_meta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * PPT 출력물 테이블
 *
 * Thread(chat) 단위로 생성/편집된 HTML 프레젠테이션을 저장한다.
 * 편집할 때마다 새 버전이 추가되며, 최신 버전이 현재 상태를 나타낸다.
 */
export const pptOutputs = pgTable("ppt_outputs", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  /** 생성된 HTML 프레젠테이션 전체 */
  html: text("html").notNull(),
  /** 버전 번호 (1부터 시작, 편집마다 증가) */
  version: text("version").notNull().default("1"),
  /** 이 버전을 만든 사용자 요청 요약 */
  prompt: text("prompt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(), // user | assistant | system
  parts: json("parts").notNull(), // UIMessagePart[] (AI SDK v6 format)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
