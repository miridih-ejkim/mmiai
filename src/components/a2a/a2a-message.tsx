'use client';

import { BotIcon, UserIcon } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { math } from '@streamdown/math';
import { cjk } from '@streamdown/cjk';

interface A2AMessageProps {
  role: 'user' | 'agent';
  text: string;
}

export function A2AMessage({ role, text }: A2AMessageProps) {
  return (
    <div className="flex gap-3 py-4">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
        {role === 'agent' ? (
          <BotIcon size={14} />
        ) : (
          <UserIcon size={14} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {role === 'user' ? (
          <div className="inline-block rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
            {text}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Streamdown plugins={{ code, mermaid, math, cjk }}>
              {text}
            </Streamdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function ThinkingMessage() {
  return (
    <div className="flex gap-3 py-4">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
        <BotIcon size={14} />
      </div>
      <div className="flex items-center gap-1 pt-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
