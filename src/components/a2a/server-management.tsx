'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  ServerIcon,
  PlusIcon,
  TrashIcon,
  RefreshCwIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  BotIcon,
  GlobeIcon,
} from 'lucide-react';
import { fetcher } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface DiscoveredAgent {
  server_id: string;
  agent_id: string;
  name: string;
  description: string | null;
  skills: string | null;
}

interface A2AServer {
  id: string;
  name: string;
  base_url: string;
  active: boolean;
  agents: DiscoveredAgent[];
}

export function ServerManagement() {
  const {
    data: servers,
    isLoading,
    mutate,
  } = useSWR<A2AServer[]>('/api/a2a/servers', fetcher);
  const [showDialog, setShowDialog] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAddServer = async () => {
    if (!formId.trim() || !formName.trim() || !formUrl.trim()) {
      setError('모든 필드를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/a2a/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: formId.trim(),
          name: formName.trim(),
          baseUrl: formUrl.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setShowDialog(false);
      setFormId('');
      setFormName('');
      setFormUrl('');
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`"${id}" 서버를 삭제하시겠습니까?`)) return;

    try {
      await fetch('/api/a2a/servers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      mutate();
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await fetch('/api/a2a/servers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
      });
      mutate();
    } catch (e) {
      console.error('Toggle error:', e);
    }
  };

  const handleRediscover = async (serverId: string) => {
    try {
      await fetch(`/api/a2a/servers/${serverId}/discover`, {
        method: 'POST',
      });
      mutate();
    } catch (e) {
      console.error('Rediscover error:', e);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">A2A Server Registry</h2>
          <p className="text-sm text-muted-foreground">
            외부 A2A 서버를 등록하면 Agent가 자동 검색됩니다.
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)} size="sm">
          <PlusIcon size={14} className="mr-1.5" />
          서버 추가
        </Button>
      </div>

      {/* Server List */}
      {!servers || servers.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <ServerIcon size={32} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            등록된 외부 서버가 없습니다.
          </p>
          <p className="text-xs text-muted-foreground/60">
            "서버 추가" 버튼으로 외부 A2A 서버를 등록하세요.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onDelete={() => handleDelete(server.id)}
              onToggle={(active) => handleToggle(server.id, active)}
              onRediscover={() => handleRediscover(server.id)}
            />
          ))}
        </div>
      )}

      {/* Add Server Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A2A 서버 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1 block text-sm font-medium">서버 ID</label>
              <Input
                placeholder="analytics-server"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                영문, 숫자, 하이픈만 허용
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">서버 이름</label>
              <Input
                placeholder="분석팀 서버"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Base URL</label>
              <Input
                placeholder="http://localhost:5000"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Mastra A2A 엔드포인트가 있는 서버 URL
              </p>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button onClick={handleAddServer} disabled={submitting}>
              {submitting ? '등록 중...' : '등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServerCard({
  server,
  onDelete,
  onToggle,
  onRediscover,
}: {
  server: A2AServer;
  onDelete: () => void;
  onToggle: (active: boolean) => void;
  onRediscover: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rediscovering, setRediscovering] = useState(false);

  const handleRediscover = async () => {
    setRediscovering(true);
    await onRediscover();
    setRediscovering(false);
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <GlobeIcon size={14} className="text-muted-foreground" />
            <span className="font-medium">{server.name}</span>
            <Badge variant={server.active ? 'default' : 'secondary'}>
              {server.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {server.base_url}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={server.active}
            onCheckedChange={(checked) => onToggle(checked)}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRediscover}
            disabled={rediscovering}
            title="Agent 재검색"
          >
            <RefreshCwIcon
              size={14}
              className={rediscovering ? 'animate-spin' : ''}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
            title="서버 삭제"
          >
            <TrashIcon size={14} />
          </Button>
        </div>
      </div>

      {/* Discovered Agents */}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {open ? (
            <ChevronDownIcon size={12} />
          ) : (
            <ChevronRightIcon size={12} />
          )}
          <BotIcon size={12} />
          <span>
            {server.agents.length} Agent
            {server.agents.length !== 1 ? 's' : ''} 발견
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1.5 pl-4">
          {server.agents.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">
              발견된 Agent가 없습니다. "재검색" 버튼을 눌러보세요.
            </p>
          ) : (
            server.agents.map((agent) => {
              const skills = agent.skills
                ? JSON.parse(agent.skills)
                : [];

              return (
                <div
                  key={agent.agent_id}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <BotIcon size={12} className="text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {agent.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({agent.agent_id})
                    </span>
                  </div>
                  {agent.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {agent.description}
                    </p>
                  )}
                  {skills.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {skills.map((skill: any) => (
                        <Badge
                          key={skill.id || skill.name}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {skill.name || skill.id}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
