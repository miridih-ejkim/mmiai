'use client';

import Link from 'next/link';
import { PlusIcon } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { SidebarHistory } from '@/components/sidebar-history';
import { ThemeToggle } from '@/components/theme-toggle';

export function AppSidebar({ userId }: { userId: string }) {
  return (
    <Sidebar>
      <SidebarHeader className="flex flex-row items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          MMIAI
        </Link>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <PlusIcon size={16} />
            <span className="sr-only">New chat</span>
          </Link>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarHistory userId={userId} />
      </SidebarContent>

      <SidebarFooter className="px-4 py-3">
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
