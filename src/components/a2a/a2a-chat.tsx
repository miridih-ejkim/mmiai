'use client';

import { useState, useRef, useCallback } from 'react';
import { BotIcon, SendIcon, SquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateUUID } from '@/lib/utils';
import { sendA2AMessage } from '@/mastra/a2a/a2a-client';
import { A2AMessage, ThinkingMessage } from './a2a-message';

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

interface A2AChatProps {
  agentId: string;
  baseUrl?: string; // 외부 서버 Agent일 경우 직접 호출
}

export function A2AChat({ agentId, baseUrl }: A2AChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        id: generateUUID(),
        role: 'user',
        text: text.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await sendA2AMessage({
          agentId,
          message: userMsg.text,
          baseUrl,
          signal: controller.signal,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: generateUUID(),
            role: 'agent',
            text: result.status === 'error'
              ? `오류: ${result.response}`
              : result.response || '(응답 없음)',
          },
        ]);
      } catch (error: any) {
        if (error.name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            id: generateUUID(),
            role: 'agent',
            text: `연결 오류: ${error.message}`,
          },
        ]);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [agentId, baseUrl, isLoading],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <BotIcon size={18} className="text-muted-foreground" />
        <span className="font-medium">{agentId}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          A2A
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BotIcon size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">
                {agentId}에게 메시지를 보내보세요.
              </p>
              <p className="mt-1 text-xs opacity-60">
                A2A 프로토콜 (JSON-RPC 2.0)
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl py-4">
            {messages.map((msg) => (
              <A2AMessage key={msg.id} role={msg.role} text={msg.text} />
            ))}
            {isLoading && <ThinkingMessage />}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t bg-background p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`${agentId}에게 메시지 입력...`}
              rows={1}
              className="w-full resize-none rounded-2xl border bg-muted/50 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ minHeight: '44px', maxHeight: '200px' }}
              disabled={isLoading}
            />
          </div>
          {isLoading ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-10 w-10 shrink-0 rounded-full"
              onClick={handleStop}
            >
              <SquareIcon size={16} />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full"
              disabled={!input.trim()}
              onClick={() => sendMessage(input)}
            >
              <SendIcon size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
