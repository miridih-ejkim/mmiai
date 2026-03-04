'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlusIcon, MessageSquareIcon, BotIcon, SettingsIcon } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { SidebarHistory } from '@/components/sidebar-history';
import { AgentList } from '@/components/a2a/agent-list';
import { ThemeToggle } from '@/components/theme-toggle';

type Tab = 'chat' | 'a2a';

export function AppSidebar({ userId }: { userId: string }) {
  const pathname = usePathname();
  const activeTab: Tab = pathname.startsWith('/a2a') ? 'a2a' : 'chat';

  return (
    <Sidebar>
      <SidebarHeader className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            MMIAI
          </Link>
          <Button variant="ghost" size="icon" asChild>
            <Link href={activeTab === 'a2a' ? '/a2a' : '/'}>
              <PlusIcon size={16} />
              <span className="sr-only">
                {activeTab === 'a2a' ? 'Agent 목록' : 'New chat'}
              </span>
            </Link>
          </Button>
        </div>

        {/* Tab 전환 */}
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          <Link
            href="/"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'chat'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquareIcon size={12} />
            Chat
          </Link>
          <Link
            href="/a2a"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'a2a'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BotIcon size={12} />
            A2A
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {activeTab === 'chat' ? (
          <SidebarHistory userId={userId} />
        ) : (
          <AgentList />
        )}
      </SidebarContent>

      <SidebarFooter className="flex flex-row items-center justify-between px-4 py-3">
        <ThemeToggle />
        {activeTab === 'a2a' && (
          <Button variant="ghost" size="icon" asChild title="A2A 설정">
            <Link href="/a2a/settings">
              <SettingsIcon size={14} />
              <span className="sr-only">A2A Settings</span>
            </Link>
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
