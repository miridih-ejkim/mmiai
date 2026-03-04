'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import { BotIcon, WrenchIcon, GlobeIcon } from 'lucide-react';
import { fetcher } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface AgentCard {
  name: string;
  description?: string;
  url?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  capabilities?: {
    streaming?: boolean;
  };
  _meta?: {
    source: 'external';
    agentId: string;
    baseUrl: string;
    serverId: string;
  };
}

export function AgentList() {
  const pathname = usePathname();
  const { data: agents, isLoading } = useSWR<AgentCard[]>(
    '/api/a2a/agents',
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        등록된 A2A Agent가 없습니다.
        <br />
        Mastra 서버가 실행 중인지 확인하세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2">
      {agents.map((agent) => {
        const isExternal = agent._meta?.source === 'external';
        const agentId = isExternal ? agent._meta!.agentId : agent.name;
        const href = isExternal
          ? `/a2a/${agentId}?baseUrl=${encodeURIComponent(agent._meta!.baseUrl)}`
          : `/a2a/${agentId}`;
        const isActive = pathname === `/a2a/${agentId}`;

        return (
          <Link
            key={isExternal ? `${agent._meta!.serverId}:${agentId}` : agentId}
            href={href}
            className={`flex flex-col gap-1 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent ${
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground'
            }`}
          >
            <div className="flex items-center gap-2">
              {isExternal ? (
                <GlobeIcon size={14} className="shrink-0 text-blue-500 opacity-60" />
              ) : (
                <BotIcon size={14} className="shrink-0 opacity-60" />
              )}
              <span className="truncate font-medium">{agent.name}</span>
            </div>
            {agent.description && (
              <p className="truncate pl-5 text-xs text-muted-foreground">
                {agent.description}
              </p>
            )}
            {agent.skills && agent.skills.length > 0 && (
              <div className="flex items-center gap-1 pl-5">
                <WrenchIcon size={10} className="opacity-40" />
                <span className="text-xs text-muted-foreground">
                  {agent.skills.length} tools
                </span>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
