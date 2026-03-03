'use client';

import { useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';

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

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';

import { ClarifyToolUI, PlanSelectToolUI } from '@/components/chat-tools';

/**
 * Tool part에서 tool name 추출
 * - static tool: type="tool-requestClarification" → "requestClarification"
 * - dynamic tool: type="dynamic-tool", toolName="requestClarification"
 */
function getToolName(part: any): string {
  if (part.type === 'dynamic-tool') return part.toolName || '';
  if (part.type?.startsWith('tool-')) return part.type.slice(5);
  return '';
}

/** Tool UI part인지 확인 */
function isToolPart(part: any): boolean {
  return part.type === 'dynamic-tool' || (typeof part.type === 'string' && part.type.startsWith('tool-'));
}

function Chat() {
  const userId =
    typeof window !== 'undefined'
      ? localStorage.getItem('mmiai-user-id') || 'default-user'
      : 'default-user';

  // 세션 단위 chatId
  const chatId = useMemo(() => {
    if (typeof window === 'undefined') return `chat-${Date.now()}`;
    const stored = sessionStorage.getItem('mmiai-chat-id');
    if (stored) return stored;
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('mmiai-chat-id', id);
    return id;
  }, []);

  const {
    messages,
    sendMessage,
    addToolApprovalResponse,
    status,
    error,
  } = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: '/mastra/chat',
      body: { userId, chatId },
      prepareSendMessagesRequest: ({ id, messages: msgs, body }) => ({
        body: {
          ...body,
          chatId: id,
          messages: msgs,
        },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    experimental_throttle: 100,
    onError: (err) => {
      console.error('[useChat] Error:', err);
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  /** 텍스트 입력 submit */
  const handleSubmit = ({ text }: { text: string }) => {
    const userText = text.trim();
    if (!userText || isLoading) return;
    sendMessage({ text: userText });
  };

  /** Clarify tool approval → 사용자 답변 전송 */
  const handleClarifyApprove = (part: any, answer: string) => {
    addToolApprovalResponse({
      id: part.approval?.id,
      approved: true,
      reason: answer,
    });
  };

  /** Ambiguous tool approval → Plan 선택 전송 */
  const handlePlanApprove = (part: any, candidate: any) => {
    addToolApprovalResponse({
      id: part.approval?.id,
      approved: true,
      reason: JSON.stringify({
        selectedPlan: candidate.planId,
        selectedTargets: candidate.targets,
        selectedExecutionMode: candidate.executionMode,
      }),
    });
  };

  return (
    <div className="w-full p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        <Conversation className="min-h-0">
          <ConversationContent>
            {messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, i) => {
                    // Text part
                    if (part.type === 'text') {
                      return (
                        <MessageResponse key={i}>
                          {part.text}
                        </MessageResponse>
                      );
                    }

                    // Tool parts — HITL UI
                    if (isToolPart(part)) {
                      const toolName = getToolName(part);
                      const toolPart = part as any;

                      if (toolName === 'requestClarification') {
                        return (
                          <ClarifyToolUI
                            key={i}
                            question={toolPart.input?.question || '추가 정보를 알려주세요.'}
                            state={toolPart.state}
                            onApprove={(answer) => handleClarifyApprove(toolPart, answer)}
                          />
                        );
                      }

                      if (toolName === 'selectExecutionPlan') {
                        return (
                          <PlanSelectToolUI
                            key={i}
                            candidates={toolPart.input?.candidates || []}
                            state={toolPart.state}
                            onApprove={(candidate) => handlePlanApprove(toolPart, candidate)}
                          />
                        );
                      }
                    }

                    return null;
                  })}
                </MessageContent>
              </Message>
            ))}

            {/* 로딩 표시 */}
            {status === 'submitted' && (
              <div className="flex items-center gap-2 text-xs text-white/50 py-2">
                <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                <span>처리 중...</span>
              </div>
            )}

            {/* 에러 표시 */}
            {error && (
              <Message from="system">
                <MessageContent>
                  <MessageResponse>
                    {`오류가 발생했습니다: ${error.message}`}
                  </MessageResponse>
                </MessageContent>
              </Message>
            )}

            <ConversationScrollButton />
          </ConversationContent>
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-20">
          <PromptInputBody>
            <PromptInputTextarea
              className="md:leading-10"
              placeholder="Type your message..."
              disabled={isLoading}
            />
          </PromptInputBody>
        </PromptInput>
      </div>
    </div>
  );
}

export default Chat;
