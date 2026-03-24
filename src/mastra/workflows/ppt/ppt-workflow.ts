import { createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { planSlidesStep } from "./steps/plan-slides";
import { renderHtmlStep, renderLoopIOSchema } from "./steps/render-html";
import { critiqueSlidesStep } from "./steps/critique-slides";
import { pptWorkflowStateSchema } from "./state";

/** 최대 Renderer-Critic 반복 횟수 (PaperBanana: T=3) */
const MAX_REFINE_ITERATIONS = 3;

/**
 * 내부 루프 Workflow: Render → Critique
 *
 * dountil 루프의 본체로 사용됩니다.
 * - render-html: 슬라이드 명세 → HTML 생성 (피드백 있으면 수정)
 * - critique-slides: HTML 품질 검증 → PASS/FAIL + 피드백
 *
 * Critic이 FAIL 반환 시 다음 iteration에서 Renderer가 피드백을 반영.
 */
const renderAndRefineWorkflow = createWorkflow({
  id: "render-and-refine",
  inputSchema: renderLoopIOSchema,
  outputSchema: renderLoopIOSchema,
  stateSchema: pptWorkflowStateSchema,
})
  .then(renderHtmlStep)
  .then(critiqueSlidesStep)
  .commit();

/**
 * PPT Workflow
 *
 * PaperBanana 아키텍처를 HTML 프레젠테이션에 적용:
 *
 * 1. plan-slides: 사용자 요청 → 슬라이드별 상세 명세 (Planner + Stylist 통합)
 * 2. dountil(render-and-refine): Renderer ↔ Critic 반복 개선 (max 3회)
 *    - Renderer: 명세 → HTML 생성
 *    - Critic: HTML 검증 → PASS/FAIL + 피드백
 *    - FAIL: 피드백 → 다음 iteration에서 Renderer가 수정
 *    - PASS: 루프 종료
 * 3. .map(): 최종 HTML 추출
 */
export const pptWorkflow = createWorkflow({
  id: "ppt-workflow",
  inputSchema: z.object({
    userRequest: z.string(),
  }),
  outputSchema: z.object({
    html: z.string(),
  }),
  stateSchema: pptWorkflowStateSchema,
})
  .then(planSlidesStep)
  .dountil(
    renderAndRefineWorkflow,
    async ({ inputData, iterationCount }) => {
      // PASS이면 루프 종료
      if (inputData.pass === true) return true;
      // 최대 반복 횟수 초과 시 강제 종료
      if (iterationCount >= MAX_REFINE_ITERATIONS) return true;
      return false;
    },
  )
  .map(async ({ inputData }) => {
    return { html: inputData.html || "" };
  })
  .commit();
