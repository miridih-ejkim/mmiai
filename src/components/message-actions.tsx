'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { UIMessage } from 'ai';

export function MessageActions({ message }: { message: UIMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex opacity-0 group-hover/message:opacity-100 transition-opacity">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={handleCopy}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>복사</TooltipContent>
      </Tooltip>
    </div>
  );
}
