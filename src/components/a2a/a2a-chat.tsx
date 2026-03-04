'use client';

import { useState, useRef, useCallback } from 'react';
import { BotIcon, SendIcon, SquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateUUID } from '@/lib/utils';
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
        // 외부 서버는 직접 호출, 로컬은 rewrite 프록시 사용
        const endpoint = baseUrl
          ? `${baseUrl}/api/a2a/${agentId}`
          : `/mastra/api/a2a/${agentId}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: generateUUID(),
            method: 'message/send',
            params: {
              message: {
                kind: 'message',
                messageId: userMsg.id,
                role: 'user',
                parts: [{ kind: 'text', text: userMsg.text }],
              },
              configuration: {
                acceptedOutputModes: ['text'],
                blocking: true,
              },
            },
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        // JSON-RPC 에러 처리
        if (data.error) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateUUID(),
              role: 'agent',
              text: `오류: ${data.error.message || JSON.stringify(data.error)}`,
            },
          ]);
          return;
        }

        // 응답 파싱: result는 Task 또는 Message
        const result = data.result;
        let agentText = '';

        if (result?.kind === 'task') {
          // Task 응답 — status.message 또는 artifacts에서 텍스트 추출
          const statusMsg = result.status?.message;
          if (statusMsg?.parts) {
            agentText = statusMsg.parts
              .filter((p: any) => p.kind === 'text')
              .map((p: any) => p.text)
              .join('\n');
          }
          // artifacts가 있으면 추가
          if (result.artifacts?.length) {
            const artifactTexts = result.artifacts
              .flatMap((a: any) => a.parts || [])
              .filter((p: any) => p.kind === 'text')
              .map((p: any) => p.text);
            if (artifactTexts.length) {
              agentText = agentText
                ? `${agentText}\n\n${artifactTexts.join('\n')}`
                : artifactTexts.join('\n');
            }
          }
        } else if (result?.kind === 'message') {
          // 직접 Message 응답
          agentText = (result.parts || [])
            .filter((p: any) => p.kind === 'text')
            .map((p: any) => p.text)
            .join('\n');
        } else if (typeof result === 'string') {
          agentText = result;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: generateUUID(),
            role: 'agent',
            text: agentText || '(응답 없음)',
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
