'use client';

import { ArrowDownIcon } from 'lucide-react';
import type { UIMessage } from 'ai';
import { PreviewMessage, ThinkingMessage } from '@/components/message';
import { Greeting } from '@/components/greeting';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import { Button } from '@/components/ui/button';

export function Messages({
  messages,
  status,
  addToolApprovalResponse,
}: {
  messages: UIMessage[];
  status: string;
  addToolApprovalResponse: (opts: {
    id: string;
    approved: boolean;
    reason: string;
  }) => void;
}) {
  const { containerRef, endRef, isAtBottom, scrollToBottom } =
    useScrollToBottom<HTMLDivElement>();

  const isLoading = status === 'submitted' || status === 'streaming';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto py-4"
      >
        {messages.length === 0 && <Greeting />}

        {messages.map((message) => (
          <PreviewMessage
            key={message.id}
            message={message}
            isLoading={isLoading}
            addToolApprovalResponse={addToolApprovalResponse}
          />
        ))}

        {status === 'submitted' && <ThinkingMessage />}

        <div ref={endRef} className="min-h-6 shrink-0" />
      </div>

      {!isAtBottom && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            onClick={scrollToBottom}
          >
            <ArrowDownIcon size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
