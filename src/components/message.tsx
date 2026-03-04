'use client';

import { memo } from 'react';
import { SparklesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { math } from '@streamdown/math';
import { cjk } from '@streamdown/cjk';
import type { UIMessage } from 'ai';
import { ClarifyToolUI, PlanSelectToolUI } from '@/components/chat-tools';
import { MessageActions } from '@/components/message-actions';

/** Tool part에서 tool name 추출 */
function getToolName(part: any): string {
  if (part.type === 'dynamic-tool') return part.toolName || '';
  if (part.type?.startsWith('tool-')) return part.type.slice(5);
  return '';
}

/** Tool UI part인지 확인 */
function isToolPart(part: any): boolean {
  return (
    part.type === 'dynamic-tool' ||
    (typeof part.type === 'string' && part.type.startsWith('tool-'))
  );
}

export const PreviewMessage = memo(
  ({
    message,
    isLoading,
    addToolApprovalResponse,
  }: {
    message: UIMessage;
    isLoading: boolean;
    addToolApprovalResponse: (opts: {
      id: string;
      approved: boolean;
      reason: string;
    }) => void;
  }) => {
    const isUser = message.role === 'user';

    const handleClarifyApprove = (part: any, answer: string) => {
      addToolApprovalResponse({
        id: part.approval?.id,
        approved: true,
        reason: answer,
      });
    };

    const handlePlanApprove = (part: any, candidate: any) => {
      addToolApprovalResponse({
        id: part.approval?.id,
        approved: true,
        reason: JSON.stringify({
          selectedPlan: candidate.planId,
          selectedTargets: candidate.targets,
          selectedExecutionMode: candidate.executionMode,
        }),
      });
    };

    return (
      <div
        className={cn(
          'group/message flex w-full gap-4 px-4 md:w-full md:max-w-3xl md:px-0',
          isUser ? 'ml-auto justify-end' : '',
        )}
      >
        {!isUser && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border bg-background">
            <SparklesIcon size={14} />
          </div>
        )}

        <div className={cn('flex min-w-0 max-w-full flex-col gap-2', isUser ? 'items-end' : '')}>
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              if (isUser) {
                return (
                  <div
                    key={i}
                    className="rounded-xl bg-primary px-3 py-2 text-primary-foreground text-sm"
                  >
                    {part.text}
                  </div>
                );
              }

              if (!part.text) return null;

              return (
                <Streamdown
                  key={i}
                  className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  plugins={{ code, mermaid, math, cjk }}
                >
                  {part.text}
                </Streamdown>
              );
            }

            if (isToolPart(part)) {
              const toolName = getToolName(part);
              const toolPart = part as any;

              if (toolName === 'requestClarification') {
                return (
                  <ClarifyToolUI
                    key={i}
                    question={
                      toolPart.input?.question || '추가 정보를 알려주세요.'
                    }
                    state={toolPart.state}
                    onApprove={(answer) =>
                      handleClarifyApprove(toolPart, answer)
                    }
                  />
                );
              }

              if (toolName === 'selectExecutionPlan') {
                return (
                  <PlanSelectToolUI
                    key={i}
                    candidates={toolPart.input?.candidates || []}
                    state={toolPart.state}
                    onApprove={(candidate) =>
                      handlePlanApprove(toolPart, candidate)
                    }
                  />
                );
              }
            }

            return null;
          })}

          {!isUser && !isLoading && (
            <MessageActions message={message} />
          )}
        </div>
      </div>
    );
  },
);

PreviewMessage.displayName = 'PreviewMessage';

export function ThinkingMessage() {
  return (
    <div className="flex w-full gap-4 px-4 md:w-full md:max-w-3xl md:px-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border bg-background">
        <SparklesIcon size={14} />
      </div>
      <div className="flex items-center gap-1 py-2">
        <div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}
