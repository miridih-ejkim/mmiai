'use client';

import Link from 'next/link';
import { PlusIcon } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ChatHeader() {
  const { open } = useSidebar();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2">
      <SidebarToggle />
      {!open && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/">
                <PlusIcon size={16} />
                <span className="sr-only">New chat</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>새 채팅</TooltipContent>
        </Tooltip>
      )}
    </header>
  );
}
