import { A2AChat } from '@/components/a2a/a2a-chat';

export default async function A2AAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ baseUrl?: string }>;
}) {
  const { agentId } = await params;
  const { baseUrl } = await searchParams;
  return <A2AChat agentId={agentId} baseUrl={baseUrl} />;
}
