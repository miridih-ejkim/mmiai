'use client';

import { useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import type { UIMessage } from 'ai';
import { useSWRConfig } from 'swr';

import { ChatHeader } from '@/components/chat-header';
import { Messages } from '@/components/messages';
import { MultimodalInput } from '@/components/multimodal-input';

export function Chat({
  id,
  initialMessages,
  userId,
  isNewChat = false,
  initialSuspendMeta = null,
}: {
  id: string;
  initialMessages: UIMessage[];
  userId: string;
  isNewChat?: boolean;
  initialSuspendMeta?: {
    runId: string;
    suspendedStep: string[] | string;
  } | null;
}) {
  const { mutate } = useSWRConfig();
  const hasNavigated = useRef(false);
  const [input, setInput] = useState('');

  // Clarify suspend 메타데이터 — 서버에서 transient data part로 수신, 다음 요청에 포함
  const suspendMetaRef = useRef<{
    runId: string;
    suspendedStep: string[] | string;
  } | null>(initialSuspendMeta);

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
      api: '/mastra/chat',
      body: { userId, chatId: id },
      prepareSendMessagesRequest: ({ id: chatId, messages: msgs, body }) => {
        const reqBody: Record<string, unknown> = {
          ...body,
          chatId,
          messages: msgs,
        };
        // Clarify resume: suspend 메타데이터 포함 후 초기화
        if (suspendMetaRef.current) {
          console.log('[useChat] Including suspendMeta in request:', suspendMetaRef.current);
          reqBody.suspendMeta = suspendMetaRef.current;
          suspendMetaRef.current = null;
        }
        return { body: reqBody };
      },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    experimental_throttle: 100,
    onData: (dataPart: any) => {
      console.log('[useChat] onData received:', dataPart);
      // 서버에서 transient data-suspend-meta part 수신 시 저장
      if (dataPart.type === 'data-suspend-meta') {
        console.log('[useChat] suspendMeta saved:', dataPart.data);
        suspendMetaRef.current = dataPart.data;
      }
    },
    onFinish: () => {
      mutate(`/api/chats?userId=${userId}`);
    },
    onError: (err) => {
      console.error('[useChat] Error:', err);
    },
  });

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    // Navigate to /chat/[id] on first message for new chats
    if (isNewChat && !hasNavigated.current) {
      hasNavigated.current = true;
      window.history.replaceState({}, '', `/chat/${id}`);
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
