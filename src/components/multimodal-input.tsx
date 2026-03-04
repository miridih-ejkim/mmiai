'use client';

import { useRef, useEffect, useCallback } from 'react';
import { ArrowUpIcon, StopCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MultimodalInput({
  input,
  setInput,
  status,
  onSubmit,
  onStop,
}: {
  input: string;
  setInput: (v: string) => void;
  status: string;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);
  const isReady = status === 'ready';

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      if (input.trim() && isReady) onSubmit();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl px-4 md:px-0">
      <div className="relative flex w-full items-end gap-2 rounded-2xl border bg-muted/50 px-4 py-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={() => { isComposing.current = false; }}
          placeholder="메시지를 입력하세요..."
          rows={1}
          className="min-h-[24px] max-h-[200px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={!isReady}
        />

        {isReady ? (
          <Button
            size="icon"
            className="size-8 shrink-0 rounded-full"
            onClick={onSubmit}
            disabled={!input.trim()}
          >
            <ArrowUpIcon size={16} />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="outline"
            className="size-8 shrink-0 rounded-full"
            onClick={onStop}
          >
            <StopCircleIcon size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
