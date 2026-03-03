import { z } from "zod";

/**
 * 재시도 이력 항목 스키마
 * quality-check 실패 시마다 누적됩니다.
 */
const retryEntrySchema = z.object({
  /** 몇 번째 시도였는지 (1-based) */
  attempt: z.number(),
  /** 실행한 Agent 목록 */
  targets: z.array(z.string()),
  /** 실행 모드 */
  executionMode: z.enum(["parallel", "sequential"]),
  /** 각 Agent에게 전달한 쿼리 */
  queries: z.array(z.object({
    agentId: z.string(),
    query: z.string(),
  })).default([]),
  /** 실패 사유 */
  reason: z.string(),
  /** Worker Agent 자기 확신도 (0.0-1.0, structuredOutput으로 수집) */
  confidence: z.number().optional(),
});

export type RetryEntry = z.infer<typeof retryEntrySchema>;

/**
 * Workflow 공유 상태 스키마
 *
 * agent-step이 실행 계획(targets, executionMode)을 기록하고,
 * quality-check가 품질 평가 후 피드백을 기록한다.
 * dountil 루프에서 classify-intent가 retryHistory를 참조하여
 * 이미 시도한 전략을 피하고, 개선된 전략을 수립한다.
 */
export const workflowStateSchema = z.object({
  /** 원본 사용자 메시지 (dountil 루프 across iteration 유지용) */
  originalMessage: z.string().optional(),
  /** 실행된 Agent 목록 (MCP ID) */
  executionTargets: z.array(z.string()).default([]),
  /** 실행 모드 (parallel | sequential) */
  executionMode: z.enum(["parallel", "sequential"]).default("parallel"),
  /** 이번 시도에서 각 Agent에게 전달한 쿼리 (agent-step에서 기록) */
  executionQueries: z.array(z.object({
    agentId: z.string(),
    query: z.string(),
  })).default([]),
  /** 이전 루프 실행 결과 피드백 (최신, quality-check에서 기록) */
  previousFeedback: z.string().optional(),
  /** 현재 재시도 횟수 (0-based, quality-check에서 증가) */
  retryCount: z.number().default(0),
  /** 재시도 전체 이력 (누적, quality-check에서 push) */
  retryHistory: z.array(retryEntrySchema).default([]),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;
