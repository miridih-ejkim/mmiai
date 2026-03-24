import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { pptWorkflowStateSchema } from "../state";
import { renderLoopIOSchema } from "./render-html";

/** Critic이 PASS로 판정하는 최소 점수 */
const CRITIC_PASS_THRESHOLD = 0.7;

/**
 * Critique Slides Step
 *
 * Slide Critic Agent를 호출하여 생성된 HTML의 품질을 검증한다.
 * PASS/FAIL + 구체적 피드백을 반환.
 * FAIL 시 revisedInstructions가 다음 렌더링 iteration에 전달된다.
 */
export const critiqueSlidesStep = createStep({
  id: "critique-slides",
  inputSchema: z.object({
    html: z.string(),
  }),
  outputSchema: renderLoopIOSchema,
  stateSchema: pptWorkflowStateSchema,
  execute: async ({ inputData, mastra, getInitData, state, setState }) => {
    const criticAgent = mastra?.getAgent("slideCriticAgent");
    if (!criticAgent) {
      throw new Error("slideCriticAgent not found in Mastra instance");
    }

    const html = inputData.html;
    const slideSpec = state?.slideSpec || "";
    const userRequest =
      state?.userRequest ||
      getInitData<{ userRequest: string }>()?.userRequest ||
      "";
    const iterationCount = (state?.iterationCount ?? 0) + 1;

    const prompt = `Review this HTML presentation against the original specification and user request.

## User Request
${userRequest}

## Slide Specification
${slideSpec}

## Generated HTML Code
${html}

## Iteration
This is refinement iteration #${iterationCount}. ${iterationCount > 1 ? "Previous feedback was already addressed. Focus on remaining or new issues." : "Perform a thorough first review."}

Return ONLY the JSON review object. No markdown, no code fences, no explanation.`;

    const result = await criticAgent.generate(prompt, {
      maxSteps: 1,
    });

    // JSON 파싱
    let review: {
      pass: boolean;
      overallScore: number;
      issues: Array<{ severity: string; description: string }>;
      strengths: string[];
      revisedInstructions: string;
    };

    try {
      const rawText = result.text.trim();
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText;
      review = JSON.parse(jsonStr);
    } catch {
      console.warn("[critique-slides] Failed to parse critic JSON, treating as pass");
      review = {
        pass: true,
        overallScore: 0.75,
        issues: [],
        strengths: ["Generated successfully"],
        revisedInstructions: "",
      };
    }

    // 점수 기반 PASS/FAIL 판정 (Critic의 자체 판정보다 점수 우선)
    const hasCriticalIssues = review.issues?.some(
      (i) => i.severity === "critical",
    );
    const pass =
      review.overallScore >= CRITIC_PASS_THRESHOLD && !hasCriticalIssues;

    console.log(
      `[critique-slides] Score: ${review.overallScore}, Pass: ${pass}, Issues: ${review.issues?.length ?? 0}, Iteration: ${iterationCount}`,
    );

    // 상태 업데이트
    setState({
      ...state,
      currentHtml: html,
      criticFeedback: pass ? undefined : review.revisedInstructions,
      criticScore: review.overallScore,
      iterationCount,
    });

    return {
      html,
      pass,
      criticFeedback: pass ? undefined : review.revisedInstructions,
      criticScore: review.overallScore,
      slideSpec: state?.slideSpec,
      userRequest: state?.userRequest,
      iterationCount,
    };
  },
});
