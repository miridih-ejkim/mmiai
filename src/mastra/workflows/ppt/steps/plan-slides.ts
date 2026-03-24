import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { pptWorkflowStateSchema } from "../state";

/**
 * Plan Slides Step
 *
 * Slide Planner Agent를 호출하여 슬라이드별 상세 명세를 생성한다.
 * 사용자 요청을 받아 JSON 형태의 슬라이드 설계를 출력한다.
 */
export const planSlidesStep = createStep({
  id: "plan-slides",
  inputSchema: z.object({
    userRequest: z.string(),
  }),
  outputSchema: z.object({
    slideSpec: z.string().optional(),
    userRequest: z.string().optional(),
    html: z.string().optional(),
    pass: z.boolean().optional(),
    criticFeedback: z.string().optional(),
    criticScore: z.number().optional(),
    iterationCount: z.number().optional(),
  }),
  stateSchema: pptWorkflowStateSchema,
  execute: async ({ inputData, mastra, setState, state }) => {
    const userRequest = inputData.userRequest;

    // 상태에 원본 요청 저장
    setState({ ...state, userRequest });

    const plannerAgent = mastra?.getAgent("slidePlannerAgent");
    if (!plannerAgent) {
      throw new Error("slidePlannerAgent not found in Mastra instance");
    }

    const prompt = `Create a detailed slide specification for the following presentation request:

${userRequest}

Return ONLY the JSON specification object. No markdown, no code fences, no explanation.`;

    const result = await plannerAgent.generate(prompt, {
      maxSteps: 1,
    });

    // LLM 응답에서 JSON 추출
    const rawText = result.text.trim();
    let slideSpec: string;

    // JSON 코드 블록 제거
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      slideSpec = jsonMatch[1].trim();
    } else {
      slideSpec = rawText;
    }

    // JSON 유효성 검증
    try {
      JSON.parse(slideSpec);
    } catch {
      console.warn("[plan-slides] Invalid JSON from planner, using raw text");
      // 그래도 진행 — Renderer가 최선을 다할 것
    }

    // 상태에 슬라이드 명세 저장
    setState({ ...state, userRequest, slideSpec });

    return { slideSpec, userRequest };
  },
});
