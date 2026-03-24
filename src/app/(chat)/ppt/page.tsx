import { cookies } from 'next/headers';
import { generateUUID } from '@/lib/utils';
import { PptChat } from '@/components/ppt-chat';

export default async function NewPptPage() {
  const id = generateUUID();
  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return <PptChat id={id} initialMessages={[]} userId={userId} isNewChat />;
}
