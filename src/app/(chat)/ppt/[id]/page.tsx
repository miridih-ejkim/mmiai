import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getChatById, getMessagesByChatId, getLatestPptOutput } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/db/utils';
import { PptChat } from '@/components/ppt-chat';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PptPage({
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

  const [dbMessages, latestOutput] = await Promise.all([
    getMessagesByChatId(id),
    getLatestPptOutput(id),
  ]);

  const initialMessages = convertToUIMessages(dbMessages);
  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return (
    <PptChat
      id={id}
      initialMessages={initialMessages}
      initialHtml={latestOutput?.html ?? null}
      userId={userId}
    />
  );
}
