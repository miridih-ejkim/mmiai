import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull().default("New Chat"),
  suspendMeta: json("suspend_meta"),
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
