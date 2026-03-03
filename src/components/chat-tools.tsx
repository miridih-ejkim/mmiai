'use client';

import { useState } from 'react';

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
  const isResponded = state === 'approval-responded';

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/90">{question}</p>
      {!isResponded && (
        <div className="flex gap-2">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && answer.trim()) {
                onApprove(answer.trim());
              }
            }}
            placeholder="답변을 입력하세요..."
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm
                       focus:border-blue-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => answer.trim() && onApprove(answer.trim())}
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
  const isResponded = state === 'approval-responded';

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/70">어떤 방식으로 처리할까요?</p>
      {candidates.map((candidate) => (
        <button
          key={candidate.planId}
          type="button"
          onClick={() => !isResponded && onApprove(candidate)}
          disabled={isResponded}
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
  );
}
