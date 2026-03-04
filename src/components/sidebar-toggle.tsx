'use client';

import { PanelLeftIcon } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function SidebarToggle() {
  const { toggleSidebar } = useSidebar();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <PanelLeftIcon size={16} />
          <span className="sr-only">Toggle sidebar</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">사이드바 토글</TooltipContent>
    </Tooltip>
  );
}
