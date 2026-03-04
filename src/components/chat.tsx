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
}: {
  id: string;
  initialMessages: UIMessage[];
  userId: string;
  isNewChat?: boolean;
}) {
  const { mutate } = useSWRConfig();
  const hasNavigated = useRef(false);
  const [input, setInput] = useState('');

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
      prepareSendMessagesRequest: ({ id: chatId, messages: msgs, body }) => ({
        body: {
          ...body,
          chatId,
          messages: msgs,
        },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    experimental_throttle: 100,
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
