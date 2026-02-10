'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';

/** 채팅 메시지 타입 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Suspend 상태 (HITL 피드백 대기) */
interface SuspendState {
  runId: string;
  reason: string;
  score: number;
  originalSource: string;
}

function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [suspendState, setSuspendState] = useState<SuspendState | null>(null);
  const msgIdRef = useRef(0);

  const nextId = () => String(++msgIdRef.current);

  useEffect(() => {
    fetch('/mastra/chat-history')
      .then((res) => res.json())
      .then((data) => setMessages(data))
      .catch(() => {});
  }, []);

  /** 워크플로우에 요청 (신규 또는 resume) */
  const sendToWorkflow = useCallback(
    async (body: Record<string, unknown>) => {
      setIsLoading(true);
      try {
        const res = await fetch('/mastra/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (data.status === 'suspended') {
          // HITL: 품질 검증 실패 → 피드백 요청
          setSuspendState({
            runId: data.runId,
            reason: data.reason,
            score: data.score,
            originalSource: data.originalSource,
          });
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `⚠️ ${data.reason}\n추가 지시나 수정된 질문을 입력해주세요.`,
            },
          ]);
        } else {
          // 정상 응답
          setSuspendState(null);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: data.response || '응답을 생성하지 못했습니다.',
            },
          ]);
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'system',
            content: `오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
          },
        ]);
        setSuspendState(null);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');

    // 사용자 메시지 추가
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: userText },
    ]);

    if (suspendState) {
      // Resume: 사용자 피드백으로 suspended 워크플로우 재개
      await sendToWorkflow({
        runId: suspendState.runId,
        resumeData: { userFeedback: userText },
      });
    } else {
      // New: 새 워크플로우 실행
      await sendToWorkflow({
        inputData: { message: userText },
      });
    }
  };

  return (
    <div className="w-full p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        <Conversation className="h-full">
          <ConversationContent>
            {messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  <MessageResponse>{message.content}</MessageResponse>
                </MessageContent>
              </Message>
            ))}
            <ConversationScrollButton />
          </ConversationContent>
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-20">
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              className="md:leading-10"
              value={input}
              placeholder={
                suspendState
                  ? '추가 지시나 수정된 질문을 입력하세요...'
                  : 'Type your message...'
              }
              disabled={isLoading}
            />
          </PromptInputBody>
        </PromptInput>
      </div>
    </div>
  );
}

export default Chat;
