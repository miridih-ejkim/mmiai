import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/db/utils';
import { Chat } from '@/components/chat';

// UUID v4 pattern to filter out non-chat requests (e.g. sourcemap files)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    notFound();
  }

  const chat = await getChatById(id);

  if (!chat) {
    notFound();
  }

  const dbMessages = await getMessagesByChatId(id);
  const initialMessages = convertToUIMessages(dbMessages);

  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return <Chat id={id} initialMessages={initialMessages} userId={userId} />;
}
