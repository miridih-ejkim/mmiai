import { z } from "zod";

/**
 * PPT Workflow 공유 상태 스키마
 *
 * Planner → Renderer → Critic 루프에서 공유되는 상태.
 * dountil 루프에서 Critic의 피드백이 다음 iteration의 Renderer로 전달된다.
 */
export const pptWorkflowStateSchema = z.object({
  /** 원본 사용자 요청 */
  userRequest: z.string().optional(),
  /** Planner가 생성한 슬라이드 명세 (JSON 문자열) */
  slideSpec: z.string().optional(),
  /** 현재 HTML 코드 */
  currentHtml: z.string().optional(),
  /** Critic의 최신 피드백 (수정 지시사항) */
  criticFeedback: z.string().optional(),
  /** Critic의 최신 점수 */
  criticScore: z.number().optional(),
  /** 현재 반복 횟수 (0-based) */
  iterationCount: z.number().default(0),
  /** 검색된 참조 HTML 예시 (Renderer 프롬프트 주입용) */
  referenceHtmls: z.array(z.string()).optional(),
});

export type PptWorkflowState = z.infer<typeof pptWorkflowStateSchema>;
