import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { pptWorkflowStateSchema } from "../state";

/**
 * dountil 루프 IO 스키마
 *
 * 1차 iteration: plan-slides의 output { slideSpec, userRequest }
 * 2차+ iteration: critique-slides의 output { html, pass, ... }
 *
 * 두 형태를 모두 수용하기 위해 전체 필드를 optional로 설정.
 */
export const renderLoopIOSchema = z.object({
  slideSpec: z.string().optional(),
  userRequest: z.string().optional(),
  html: z.string().optional(),
  pass: z.boolean().optional(),
  criticFeedback: z.string().optional(),
  criticScore: z.number().optional(),
  iterationCount: z.number().optional(),
});

/**
 * Render HTML Step
 *
 * HTML Renderer Agent를 호출하여 슬라이드 명세를 HTML로 변환한다.
 * Critic 피드백이 있으면 이를 참조하여 수정된 HTML을 생성한다.
 */
export const renderHtmlStep = createStep({
  id: "render-html",
  inputSchema: renderLoopIOSchema,
  outputSchema: z.object({
    html: z.string(),
  }),
  stateSchema: pptWorkflowStateSchema,
  execute: async ({ inputData, mastra, getInitData, state, setState }) => {
    const rendererAgent = mastra?.getAgent("htmlRendererAgent");
    if (!rendererAgent) {
      throw new Error("htmlRendererAgent not found in Mastra instance");
    }

    // 슬라이드 명세: input 또는 state에서 가져옴
    const slideSpec =
      inputData.slideSpec || state?.slideSpec || "";
    const userRequest =
      inputData.userRequest ||
      state?.userRequest ||
      getInitData<{ userRequest: string }>()?.userRequest ||
      "";
    const criticFeedback =
      inputData.criticFeedback || state?.criticFeedback;
    const currentHtml =
      inputData.html || state?.currentHtml;

    let prompt: string;

    if (criticFeedback && currentHtml) {
      // 반복 개선: 기존 HTML + Critic 피드백 기반 수정
      prompt = `You previously generated an HTML presentation that needs improvements.

## Original Slide Specification
${slideSpec}

## Current HTML (needs fixes)
${currentHtml}

## Critic Feedback — Fix These Issues
${criticFeedback}

Generate the COMPLETE revised HTML file addressing ALL the feedback above.
Return ONLY the HTML code. Start with <!DOCTYPE html> and end with </html>.
Do NOT wrap in markdown code fences.`;
    } else {
      // 첫 렌더링
      prompt = `Generate a complete, self-contained HTML presentation from this specification:

## User Request
${userRequest}

## Slide Specification
${slideSpec}

Return ONLY the complete HTML code. Start with <!DOCTYPE html> and end with </html>.
Do NOT wrap in markdown code fences.`;
    }

    const result = await rendererAgent.generate(prompt, {
      maxSteps: 1,
    });

    let html = result.text.trim();

    // HTML 코드 블록 제거
    const htmlMatch = html.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (htmlMatch) {
      html = htmlMatch[1].trim();
    }

    // 기본 유효성 확인
    if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
      console.warn("[render-html] Output doesn't look like valid HTML");
    }

    // 상태 업데이트
    setState({
      ...state,
      userRequest,
      slideSpec,
      currentHtml: html,
    });

    return { html };
  },
});
