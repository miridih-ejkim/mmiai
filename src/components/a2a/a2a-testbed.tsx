'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { BotIcon, GlobeIcon, WrenchIcon, ZapIcon } from 'lucide-react';
import { fetcher } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { A2AAgentCardWithMeta } from '@/mastra/a2a/a2a-client';

export function A2ATestbed() {
  const { data: agents, isLoading } = useSWR<A2AAgentCardWithMeta[]>(
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
              const isExternal = agent.source === 'external';
              const href = isExternal
                ? `/a2a/${agent.id}?baseUrl=${encodeURIComponent(agent.baseUrl!)}`
                : `/a2a/${agent.id}`;

              return (
              <Link
                key={isExternal ? `${agent.serverId}:${agent.id}` : agent.id}
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
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                      external
                    </span>
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
