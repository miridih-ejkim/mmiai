'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { BotIcon, WrenchIcon, ZapIcon, GlobeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { fetcher } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface AgentCard {
  name: string;
  description?: string;
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

export function A2ATestbed() {
  const { data: agents, isLoading } = useSWR<AgentCard[]>(
    '/api/a2a/agents',
    fetcher,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">A2A Testbed</h1>
        <p className="text-sm text-muted-foreground">
          등록된 Agent를 선택하여 A2A 프로토콜로 대화하세요.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : !agents || agents.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-center text-muted-foreground">
            <div>
              <BotIcon size={48} className="mx-auto mb-4 opacity-20" />
              <p>등록된 A2A Agent가 없습니다.</p>
              <p className="mt-1 text-sm opacity-60">
                Mastra 서버가 실행 중인지 확인하세요.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const isExternal = agent._meta?.source === 'external';
              const agentId = isExternal ? agent._meta!.agentId : agent.name;
              const href = isExternal
                ? `/a2a/${agentId}?baseUrl=${encodeURIComponent(agent._meta!.baseUrl)}`
                : `/a2a/${agentId}`;

              return (
                <Link
                  key={isExternal ? `${agent._meta!.serverId}:${agentId}` : agent.name}
                  href={href}
                  className="group flex flex-col gap-3 rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isExternal ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
                      {isExternal ? (
                        <GlobeIcon size={16} className="text-blue-500" />
                      ) : (
                        <BotIcon size={16} className="text-primary" />
                      )}
                    </div>
                    <span className="font-medium">{agent.name}</span>
                    {isExternal && (
                      <Badge variant="outline" className="text-[10px]">
                        External
                      </Badge>
                    )}
                  </div>

                  {agent.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {agent.description}
                    </p>
                  )}

                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                    {agent.skills && agent.skills.length > 0 && (
                      <span className="flex items-center gap-1">
                        <WrenchIcon size={12} />
                        {agent.skills.length} tools
                      </span>
                    )}
                    {agent.capabilities?.streaming && (
                      <span className="flex items-center gap-1">
                        <ZapIcon size={12} />
                        streaming
                      </span>
                    )}
                    {isExternal && (
                      <span className="truncate text-[10px] opacity-60">
                        {agent._meta!.baseUrl}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
