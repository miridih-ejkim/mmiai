import { cookies } from 'next/headers';
import { generateUUID } from '@/lib/utils';
import { Chat } from '@/components/chat';

export default async function NewChatPage() {
  const id = generateUUID();
  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return <Chat id={id} initialMessages={[]} userId={userId} isNewChat />;
}
