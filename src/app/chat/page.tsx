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

/** Plan 후보 (ambiguous 타입) */
interface PlanCandidate {
  planId: string;
  label: string;
  description: string;
  targets: string[];
  executionMode: 'parallel' | 'sequential';
  expectedOutcome: string;
}

/** Suspend 상태 (HITL) */
interface SuspendState {
  runId: string;
  suspendedStep: string[] | string;
  hitlType: 'clarify' | 'ambiguous';
  clarifyQuestion?: string;
  candidates?: PlanCandidate[];
  originalMessage: string;
}

function Chat() {
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
          const hitlType = data.hitlType as 'clarify' | 'ambiguous';

          setSuspendState({
            runId: data.runId,
            suspendedStep: data.suspendedStep,
            hitlType,
            clarifyQuestion: data.clarifyQuestion,
            candidates: data.candidates,
            originalMessage: data.originalMessage || lastUserMessageRef.current,
          });

          if (hitlType === 'clarify') {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: data.clarifyQuestion || '추가 정보를 알려주세요.',
              },
            ]);
          }
          // ambiguous → plan 선택 카드 UI (별도 렌더링)
        } else {
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

  /** ambiguous: Plan 선택 카드 클릭 */
  const handlePlanSelect = useCallback(
    async (candidate: PlanCandidate) => {
      if (!suspendState || isLoading) return;

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', content: `"${candidate.label}" 선택` },
      ]);

      await sendToWorkflow({
        runId: suspendState.runId,
        suspendedStep: suspendState.suspendedStep,
        resumeData: {
          selectedPlan: candidate.planId,
          selectedTargets: candidate.targets,
          selectedExecutionMode: candidate.executionMode,
        },
      });
    },
    [suspendState, isLoading, sendToWorkflow],
  );

  /** 텍스트 입력 후 submit */
  const handleSubmit = async ({ text }: { text: string }) => {
    if (isLoading) return;

    const userText = text.trim();
    if (!userText) return;

    if (suspendState) {
      if (suspendState.hitlType === 'clarify') {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'user', content: userText },
        ]);

        await sendToWorkflow({
          runId: suspendState.runId,
          suspendedStep: suspendState.suspendedStep,
          resumeData: { userAnswer: userText },
        });
      } else if (suspendState.hitlType === 'ambiguous') {
        // ambiguous 모드에서 텍스트 입력 시 → 새 워크플로우로 시작
        lastUserMessageRef.current = userText;
        setSuspendState(null);

        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'user', content: userText },
        ]);

        await sendToWorkflow({
          runId: suspendState.runId,
          resumeData: { action: 'new', userFeedback: userText },
        });
      }
    } else {
      // 일반 모드
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
        <Conversation className="min-h-0">
          <ConversationContent>
            {messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  <MessageResponse>{message.content}</MessageResponse>
                </MessageContent>
              </Message>
            ))}

            {/* ambiguous: Plan 선택 카드 */}
            {suspendState?.hitlType === 'ambiguous' && suspendState.candidates && (
              <div className="mx-auto w-full max-w-2xl space-y-2 py-2">
                <p className="text-sm text-white/70 mb-3">
                  어떤 방식으로 처리할까요?
                </p>
                {suspendState.candidates.map((candidate) => (
                  <button
                    key={candidate.planId}
                    type="button"
                    onClick={() => handlePlanSelect(candidate)}
                    disabled={isLoading}
                    className="w-full text-left rounded-lg border border-white/10 p-4
                               hover:bg-white/5 hover:border-blue-500/50 transition-colors
                               cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="font-medium text-sm">{candidate.label}</div>
                    <div className="text-xs text-white/50 mt-1">{candidate.description}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-blue-400/70 bg-blue-500/10 px-2 py-0.5 rounded">
                        {candidate.expectedOutcome}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <ConversationScrollButton />
          </ConversationContent>
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-20">
          <PromptInputBody>
            <PromptInputTextarea
              className="md:leading-10"
              placeholder={
                suspendState?.hitlType === 'clarify'
                  ? '답변을 입력하세요...'
                  : suspendState?.hitlType === 'ambiguous'
                    ? '위에서 선택하거나 새 질문을 입력하세요'
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
