import { z } from "zod";

/**
 * Workflow 공유 상태 스키마
 *
 * agent-step이 실행 계획(targets, executionMode)을 기록하고,
 * quality-check가 품질 평가 후 피드백을 기록한다.
 * dountil 루프에서 classify-intent가 previousFeedback을 참조하여
 * 자동 재시도/clarify/ambiguous를 판단한다.
 */
export const workflowStateSchema = z.object({
  /** 실행된 Agent 목록 (MCP ID) */
  executionTargets: z.array(z.string()).default([]),
  /** 실행 모드 (parallel | sequential) */
  executionMode: z.enum(["parallel", "sequential"]).default("parallel"),
  /** 이전 루프 실행 결과 피드백 (quality-check에서 기록) */
  previousFeedback: z.string().optional(),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;
