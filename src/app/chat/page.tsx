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

/** HITL 선택지 */
interface SuspendOption {
  value: 'refine' | 'reroute' | 'new';
  label: string;
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
  options: SuspendOption[];
  availableAgents: AvailableAgent[];
}

type ActionType = 'refine' | 'reroute' | 'new';

function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [suspendState, setSuspendState] = useState<SuspendState | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionType>('refine');
  const [selectedAgent, setSelectedAgent] = useState('');
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
        // userId를 모든 요청에 포함 (향후 auth 연동 시 교체)
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
            options: data.options || [],
            availableAgents: data.availableAgents || [],
          });
          setSelectedAction('refine');
          setSelectedAgent(data.availableAgents?.[0]?.value || '');
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `\u26a0\ufe0f ${data.reason}\n\uc544\ub798\uc5d0\uc11c \ub2e4\uc74c \uc561\uc158\uc744 \uc120\ud0dd\ud574\uc8fc\uc138\uc694.`,
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

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: userText },
    ]);

    if (suspendState) {
      if (selectedAction === 'new') {
        // 새 질문: 새 workflow 시작
        lastUserMessageRef.current = userText;
        setSuspendState(null);
        await sendToWorkflow({ inputData: { message: userText } });
      } else if (selectedAction === 'reroute') {
        // 다른 Agent로 전환: resume으로 quality-check에서 targetAgent 호출
        await sendToWorkflow({
          runId: suspendState.runId,
          resumeData: { action: 'reroute', targetAgent: selectedAgent, userFeedback: userText || undefined },
        });
      } else {
        // 보완 지시: resume으로 같은 Agent + 원본 질문 + 피드백
        await sendToWorkflow({
          runId: suspendState.runId,
          resumeData: { action: 'refine', userFeedback: userText },
        });
      }
    } else {
      lastUserMessageRef.current = userText;
      await sendToWorkflow({
        inputData: { message: userText },
      });
    }
  };

  const placeholderByAction: Record<ActionType, string> = {
    refine: '\ucd94\uac00 \uc9c0\uc2dc\ub97c \uc785\ub825\ud558\uc138\uc694 (\uc608: "\ub354 \uc790\uc138\ud788 \uac80\uc0c9\ud574\uc918")',
    reroute: '\ucd94\uac00 \uc9c0\uc2dc\ub97c \uc785\ub825\ud558\uac70\ub098 \ube48 \uce78\uc73c\ub85c \uc804\uc1a1\ud558\uc138\uc694',
    new: '\uc0c8\ub85c\uc6b4 \uc9c8\ubb38\uc744 \uc785\ub825\ud558\uc138\uc694',
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

        {/* HITL 선택지 패널 */}
        {suspendState && suspendState.options.length > 0 && (
          <div className="mx-auto w-full max-w-2xl rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 mb-3">
            <div className="space-y-3">
              {suspendState.options.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                    selectedAction === option.value
                      ? 'border-yellow-500 bg-yellow-500/10'
                      : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="hitl-action"
                    value={option.value}
                    checked={selectedAction === option.value}
                    onChange={(e) => setSelectedAction(e.target.value as ActionType)}
                    className="mt-0.5 accent-yellow-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{option.label}</span>
                    {/* reroute 선택 시 Agent 선택 */}
                    {option.value === 'reroute' && selectedAction === 'reroute' && (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {suspendState.availableAgents.map((agent) => (
                          <button
                            key={agent.value}
                            type="button"
                            onClick={() => setSelectedAgent(agent.value)}
                            className={`rounded-full px-3 py-1 text-xs transition-colors ${
                              selectedAgent === agent.value
                                ? 'bg-yellow-500 text-black'
                                : 'bg-white/10 hover:bg-white/20'
                            }`}
                          >
                            {agent.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              ))}
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
                  ? placeholderByAction[selectedAction]
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
