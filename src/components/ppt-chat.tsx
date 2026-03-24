'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { useSWRConfig } from 'swr';

import { ChatHeader } from '@/components/chat-header';
import { Messages } from '@/components/messages';
import { MultimodalInput } from '@/components/multimodal-input';
import { useCanvas } from '@/components/canvas';

/** 메시지에 PPT 참조 마커가 있는지 확인 */
const PPT_REF_RE = /<!--MMIAI_PPT_REF:/;

/**
 * PPT Chat Component
 *
 * Chat UI와 동일한 구조이지만 PPT Workflow를 호출하고
 * 생성된 HTML을 Canvas 패널에 자동으로 표시한다.
 * HTML은 ppt_outputs 테이블에서 조회한다.
 */
export function PptChat({
  id,
  initialMessages,
  initialHtml,
  userId,
  isNewChat = false,
}: {
  id: string;
  initialMessages: UIMessage[];
  /** 서버에서 미리 조회한 최신 PPT HTML (SSR) */
  initialHtml?: string | null;
  userId: string;
  isNewChat?: boolean;
}) {
  const { mutate } = useSWRConfig();
  const hasNavigated = useRef(false);
  const [input, setInput] = useState('');
  const { openCanvas } = useCanvas();
  const lastFetchedRef = useRef<string | null>(null);

  const {
    messages,
    sendMessage,
    addToolApprovalResponse,
    status,
    stop,
    error,
  } = useChat({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/mastra/ppt/chat',
      body: { userId, chatId: id },
    }),
    experimental_throttle: 100,
    onFinish: () => {
      mutate(`/api/ppt/chats?userId=${userId}`);
      // 응답 완료 후 최신 HTML을 DB에서 fetch하여 Canvas에 표시
      fetchAndOpenCanvas();
    },
    onError: (err) => {
      console.error('[PptChat] Error:', err);
    },
  });

  /** DB에서 최신 PPT HTML을 가져와 Canvas에 표시 */
  const fetchAndOpenCanvas = useCallback(async () => {
    try {
      const res = await fetch(`/api/ppt/output?chatId=${id}`);
      const data = await res.json();
      if (data.html) {
        openCanvas(data.html, input.slice(0, 50) || 'Presentation');
      }
    } catch (e) {
      console.error('[PptChat] Failed to fetch PPT output:', e);
    }
  }, [id, openCanvas, input]);

  // 초기 로드 시: 서버에서 전달받은 HTML로 Canvas 표시
  useEffect(() => {
    if (initialHtml) {
      openCanvas(initialHtml, 'Presentation');
    }
  }, []); // 최초 마운트 시 1회만

  // 메시지에 PPT 참조 마커가 새로 추가되면 Canvas 갱신
  useEffect(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    if (!lastAssistant || lastAssistant.id === lastFetchedRef.current) return;

    const hasPptRef = lastAssistant.parts.some(
      (p) => p.type === 'text' && PPT_REF_RE.test(p.text),
    );

    if (hasPptRef && status === 'ready') {
      lastFetchedRef.current = lastAssistant.id;
      fetchAndOpenCanvas();
    }
  }, [messages, status, fetchAndOpenCanvas]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    if (isNewChat && !hasNavigated.current) {
      hasNavigated.current = true;
      window.history.replaceState({}, '', `/ppt/${id}`);
    }

    sendMessage({ text });
    setInput('');
  };

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background">
      <ChatHeader />

      <Messages
        messages={messages}
        status={status}
        addToolApprovalResponse={addToolApprovalResponse}
      />

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            오류가 발생했습니다: {error.message}
          </div>
        </div>
      )}

      <div className="pb-4 pt-2">
        <MultimodalInput
          input={input}
          setInput={setInput}
          status={status}
          onSubmit={handleSubmit}
          onStop={stop}
        />
      </div>
    </div>
  );
}
