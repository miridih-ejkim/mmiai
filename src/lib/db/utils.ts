import type { UIMessage } from 'ai';

/**
 * DB message rows → AI SDK UIMessage[] 변환
 */
export function convertToUIMessages(
  dbMessages: Array<{
    id: string;
    role: string;
    parts: unknown;
    createdAt: Date;
  }>,
): UIMessage[] {
  return dbMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as UIMessage['role'],
    parts: (msg.parts as UIMessage['parts']) ?? [{ type: 'text', text: '' }],
    createdAt: msg.createdAt,
  }));
}
