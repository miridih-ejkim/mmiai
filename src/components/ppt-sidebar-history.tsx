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

interface PptItem {
  id: string;
  title: string;
  createdAt: string;
}

export function PptSidebarHistory({ userId }: { userId: string }) {
  const { id: activeId } = useParams<{ id?: string }>();
  const router = useRouter();

  const { data: items, mutate } = useSWR<PptItem[]>(
    `/api/ppt/chats?userId=${userId}`,
    fetcher,
  );

  const handleDelete = async (chatId: string) => {
    await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
    mutate();
    if (chatId === activeId) {
      router.push('/ppt');
    }
  };

  if (!items) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2">
            {Array.from({ length: 3 }).map((_, i) => (
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

  if (items.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-sm text-muted-foreground">
            아직 생성된 프레젠테이션이 없습니다.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>PPT History</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton asChild isActive={item.id === activeId}>
                <Link href={`/ppt/${item.id}`}>
                  <span className="truncate">{item.title}</span>
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
                    onClick={() => handleDelete(item.id)}
                  >
                    <TrashIcon />
                    <span>삭제</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
