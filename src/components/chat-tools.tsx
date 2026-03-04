'use client';

import { useState } from 'react';
import { CheckIcon, MessageSquareIcon } from 'lucide-react';

/** Plan 후보 (ambiguous 타입) */
interface PlanCandidate {
  planId: string;
  label: string;
  description: string;
  targets: string[];
  executionMode: 'parallel' | 'sequential';
  expectedOutcome: string;
}

/** Clarify Tool UI — 서버가 보낸 질문 표시 + 사용자 답변 입력 */
export function ClarifyToolUI({
  question,
  state,
  onApprove,
}: {
  question: string;
  state: string;
  onApprove: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);
  const isResponded = state === 'approval-responded' || submittedAnswer !== null;

  const handleSubmit = () => {
    const text = answer.trim();
    if (!text) return;
    setSubmittedAnswer(text);
    onApprove(text);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{question}</p>
      {isResponded ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <MessageSquareIcon size={14} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">{submittedAnswer || '(답변 전송됨)'}</p>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && answer.trim()) {
                handleSubmit();
              }
            }}
            placeholder="답변을 입력하세요..."
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm
                       focus:border-blue-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!answer.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium
                       hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            전송
          </button>
        </div>
      )}
    </div>
  );
}

/** Plan Select Tool UI — 실행 계획 카드 + 선택 */
export function PlanSelectToolUI({
  candidates,
  state,
  onApprove,
}: {
  candidates: PlanCandidate[];
  state: string;
  onApprove: (candidate: PlanCandidate) => void;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const isResponded = state === 'approval-responded' || selectedPlanId !== null;

  const handleSelect = (candidate: PlanCandidate) => {
    if (isResponded) return;
    setSelectedPlanId(candidate.planId);
    onApprove(candidate);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">어떤 방식으로 처리할까요?</p>
      {candidates.map((candidate) => {
        const isSelected = selectedPlanId === candidate.planId;
        const isOther = isResponded && !isSelected;

        return (
          <button
            key={candidate.planId}
            type="button"
            onClick={() => handleSelect(candidate)}
            disabled={isResponded}
            className={`w-full text-left rounded-lg border p-4 transition-colors
              ${isSelected
                ? 'border-primary bg-primary/5 cursor-default'
                : isOther
                  ? 'border-border opacity-40 cursor-not-allowed'
                  : 'border-border hover:bg-muted hover:border-ring cursor-pointer'
              }
              disabled:cursor-not-allowed`}
          >
            <div className="flex items-center gap-2">
              {isSelected && (
                <CheckIcon size={14} className="shrink-0 text-primary" />
              )}
              <div className="font-medium text-sm">{candidate.label}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{candidate.description}</div>
            {!isOther && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {candidate.expectedOutcome}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
