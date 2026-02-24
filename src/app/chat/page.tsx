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

/** AI가 생성한 개선 제안 */
interface HitlSuggestion {
  id: string;
  description: string;
  actionType: 'refine' | 'reroute';
  refinedQuery?: string;
  targetAgent?: string;
}

/** reroute 가능한 Agent */
interface AvailableAgent {
  value: string;
  label: string;
}

/** Suspend 상태 (HITL 피드백 대기) */
interface SuspendState {
  runId: string;
  reason: string;
  score: number;
  originalSource: string;
  originalMessage: string;
  originalQuery: string;
  suggestions: HitlSuggestion[];
  availableAgents: AvailableAgent[];
}

function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [suspendState, setSuspendState] = useState<SuspendState | null>(null);
  const msgIdRef = useRef(0);
  const lastUserMessageRef = useRef('');
  // 세션 단위 threadId (탭/페이지 단위로 대화 분리)
  const threadIdRef = useRef(
    typeof window !== 'undefined'
      ? sessionStorage.getItem('mmiai-thread-id') || (() => {
          const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          sessionStorage.setItem('mmiai-thread-id', id);
          return id;
        })()
      : `thread-${Date.now()}`,
  );

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
        const userId = typeof window !== 'undefined'
          ? localStorage.getItem('mmiai-user-id') || 'default-user'
          : 'default-user';
        const res = await fetch('/mastra/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, userId, threadId: threadIdRef.current }),
        });

        if (!res.ok) {
          const text = await res.text();
          let errorMsg: string;
          try {
            const errJson = JSON.parse(text);
            errorMsg = errJson.error || errJson.message || text;
          } catch {
            errorMsg = text || `서버 오류 (${res.status})`;
          }
          throw new Error(errorMsg);
        }

        const data = await res.json();

        if (data.status === 'suspended') {
          setSuspendState({
            runId: data.runId,
            reason: data.reason,
            score: data.score,
            originalSource: data.originalSource,
            originalMessage: lastUserMessageRef.current,
            originalQuery: data.originalQuery || lastUserMessageRef.current,
            suggestions: data.suggestions || [],
            availableAgents: data.availableAgents || [],
          });
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `\u26a0\ufe0f ${data.reason}\n\uc544\ub798\uc5d0\uc11c \uac1c\uc120 \ubc29\ubc95\uc744 \uc120\ud0dd\ud558\uac70\ub098 \uc9c1\uc811 \uc785\ub825\ud574\uc8fc\uc138\uc694.`,
            },
          ]);
        } else {
          setSuspendState(null);
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: data.response || '\uc751\ub2f5\uc744 \uc0dd\uc131\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.',
            },
          ]);
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'system',
            content: `\uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4: ${error instanceof Error ? error.message : '\uc54c \uc218 \uc5c6\ub294 \uc624\ub958'}`,
          },
        ]);
        setSuspendState(null);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /** AI 제안 카드 클릭 */
  const handleSuggestionClick = useCallback(
    async (suggestion: HitlSuggestion) => {
      if (!suspendState || isLoading) return;

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', content: suggestion.description },
      ]);

      await sendToWorkflow({
        runId: suspendState.runId,
        resumeData: {
          action: 'suggestion',
          suggestionId: suggestion.id,
          refinedQuery: suggestion.refinedQuery,
          targetAgent: suggestion.targetAgent,
        },
      });
    },
    [suspendState, isLoading, sendToWorkflow],
  );

  /** 워크플로우 종료 (bail) */
  const handleDismiss = useCallback(async () => {
    if (!suspendState || isLoading) return;

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'system', content: '\uc6cc\ud06c\ud50c\ub85c\uc6b0\uac00 \uc885\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.' },
    ]);

    await sendToWorkflow({
      runId: suspendState.runId,
      resumeData: { action: 'dismiss' },
    });

    setSuspendState(null);
  }, [suspendState, isLoading, sendToWorkflow]);

  /** 텍스트 입력 후 submit */
  const handleSubmit = async () => {
    if (isLoading) return;

    const userText = input.trim();
    setInput('');

    if (suspendState) {
      // HITL 모드: 텍스트 입력 시 refine (같은 Agent + 추가 지시)
      if (!userText) return;

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', content: userText },
      ]);

      await sendToWorkflow({
        runId: suspendState.runId,
        resumeData: { action: 'refine', userFeedback: userText },
      });
    } else {
      // 일반 모드
      if (!userText) return;
      lastUserMessageRef.current = userText;
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', content: userText },
      ]);
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

        {/* HITL 제안 패널 */}
        {suspendState && (
          <div className="mx-auto w-full max-w-2xl rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 mb-3">
            <p className="text-sm text-yellow-200/80 mb-3">
              AI가 다음과 같은 개선 방법을 제안합니다:
            </p>

            {/* AI 제안 카드 */}
            <div className="space-y-2 mb-3">
              {suspendState.suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={isLoading}
                  className="w-full text-left rounded-md border border-white/10 p-3
                             hover:bg-white/5 hover:border-yellow-500/50 transition-colors
                             cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 shrink-0 mt-0.5">
                      {suggestion.actionType === 'refine' ? '\uD83D\uDD04 \ubcf4\uc644' : '\uD83D\uDD00 \uc804\ud658'}
                    </span>
                    <span className="text-sm">{suggestion.description}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* 수동 옵션 (접기) */}
            <details className="text-xs text-white/50">
              <summary className="cursor-pointer hover:text-white/70 mb-2">
                직접 입력하기
              </summary>
              <div className="space-y-2">
                {suspendState.availableAgents.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {suspendState.availableAgents.map((agent) => (
                      <button
                        key={agent.value}
                        type="button"
                        disabled={isLoading}
                        onClick={async () => {
                          if (!suspendState || isLoading) return;
                          setMessages((prev) => [
                            ...prev,
                            { id: nextId(), role: 'user', content: `${agent.label}(으)로 전환합니다.` },
                          ]);
                          await sendToWorkflow({
                            runId: suspendState.runId,
                            resumeData: { action: 'reroute', targetAgent: agent.value },
                          });
                        }}
                        className="rounded-full px-3 py-1 text-xs bg-white/10 hover:bg-white/20
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {agent.label}(으)로 전환
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-white/40">
                  텍스트를 입력하고 전송하면 같은 Agent에 추가 지시를 보냅니다.
                </p>
              </div>
            </details>

            {/* Dismiss 버튼 */}
            <div className="mt-3 pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={handleDismiss}
                disabled={isLoading}
                className="text-xs text-white/40 hover:text-white/60 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                \u2715 검색을 종료합니다
              </button>
            </div>
          </div>
        )}

        <PromptInput onSubmit={handleSubmit} className="mt-20">
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              className="md:leading-10"
              value={input}
              placeholder={
                suspendState
                  ? '추가 지시를 입력하거나 위 제안을 클릭하세요'
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
