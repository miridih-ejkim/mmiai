'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { MoreHorizontalIcon, TrashIcon } from 'lucide-react';
import useSWR from 'swr';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetcher } from '@/lib/utils';

interface ChatItem {
  id: string;
  title: string;
  createdAt: string;
}

type GroupedChats = {
  today: ChatItem[];
  yesterday: ChatItem[];
  lastWeek: ChatItem[];
  older: ChatItem[];
};

function groupChatsByDate(chats: ChatItem[]): GroupedChats {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const groups: GroupedChats = { today: [], yesterday: [], lastWeek: [], older: [] };

  for (const chat of chats) {
    const d = new Date(chat.createdAt);
    if (d >= todayStart) groups.today.push(chat);
    else if (d >= yesterdayStart) groups.yesterday.push(chat);
    else if (d >= weekStart) groups.lastWeek.push(chat);
    else groups.older.push(chat);
  }

  return groups;
}

export function SidebarHistory({ userId }: { userId: string }) {
  const { id: activeChatId } = useParams<{ id?: string }>();
  const router = useRouter();

  const { data: chats, mutate } = useSWR<ChatItem[]>(
    `/api/chats?userId=${userId}`,
    fetcher,
  );

  const handleDelete = async (chatId: string) => {
    await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
    mutate();
    if (chatId === activeChatId) {
      router.push('/');
    }
  };

  if (!chats) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse"
              />
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (chats.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-sm text-muted-foreground">
            No chat history yet.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const grouped = groupChatsByDate(chats);

  const renderGroup = (label: string, items: ChatItem[]) => {
    if (items.length === 0) return null;
    return (
      <SidebarGroup key={label}>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((chat) => (
              <SidebarMenuItem key={chat.id}>
                <SidebarMenuButton
                  asChild
                  isActive={chat.id === activeChatId}
                >
                  <Link href={`/chat/${chat.id}`}>
                    <span className="truncate">{chat.title}</span>
                  </Link>
                </SidebarMenuButton>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction showOnHover>
                      <MoreHorizontalIcon />
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDelete(chat.id)}
                    >
                      <TrashIcon />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <>
      {renderGroup('Today', grouped.today)}
      {renderGroup('Yesterday', grouped.yesterday)}
      {renderGroup('Last 7 days', grouped.lastWeek)}
      {renderGroup('Older', grouped.older)}
    </>
  );
}
