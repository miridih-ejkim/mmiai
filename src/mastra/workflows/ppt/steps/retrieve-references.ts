import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { embed } from "ai";
import { pptWorkflowStateSchema } from "../state";
import { renderLoopIOSchema } from "./render-html";

const INDEX_NAME = "infographic_references";
const TOP_K = 3;
const MIN_SCORE = 0.3; // post-query 필터링에 사용

/**
 * Planner의 layoutType → 렌더링 technique 매핑 테이블
 *
 * Planner가 출력하는 layoutType은 "슬라이드 유형"이고,
 * Vector DB에 저장된 technique은 "렌더링 기법"이므로 변환이 필요.
 * 하나의 layoutType이 여러 technique의 참조를 필요로 할 수 있다.
 */
const LAYOUT_TO_TECHNIQUES: Record<string, string[]> = {
  title_slide: ["split-ratio", "emphasis-placement"],
  section_header: ["emphasis-placement"],
  bullet_points: ["grid-balance", "emphasis-placement"],
  two_column: ["split-ratio", "alternating-align"],
  image_text: ["split-ratio", "image-aspect"],
  diagram: ["node-connector"],
  comparison: ["split-ratio", "grid-balance"],
  timeline: ["node-connector"],
  quote: ["emphasis-placement"],
  closing: ["emphasis-placement", "grid-balance"],
};

/**
 * slideSpec JSON에서 필요한 technique 목록과 검색 쿼리를 구성한다.
 */
function buildSearchParams(
  slideSpec: string,
  userRequest: string,
): { techniques: string[]; queryText: string } {
  const allTechniques = new Set<string>();
  const queryParts: string[] = [];

  try {
    const spec = JSON.parse(slideSpec);

    // 슬라이드별 layoutType에서 technique 매핑
    const layouts: string[] =
      spec.slides?.map((s: any) => s.layoutType).filter(Boolean) || [];

    for (const layout of layouts) {
      const techniques = LAYOUT_TO_TECHNIQUES[layout];
      if (techniques) {
        techniques.forEach((t) => allTechniques.add(t));
      }
    }

    // 쿼리 구성: layoutType + designNotes 키워드
    const uniqueLayouts = [...new Set(layouts)];
    if (uniqueLayouts.length > 0) {
      queryParts.push(uniqueLayouts.join(", "));
    }

    // designNotes에서 렌더링 힌트 추출
    const designHints = spec.slides
      ?.map((s: any) => s.designNotes)
      .filter(Boolean)
      .join(" ");
    if (designHints) {
      // 핵심 렌더링 키워드만 추출
      const renderingKeywords = designHints.match(
        /\b(connector|arrow|flow|split|grid|card|progress|timeline|chart|bar|circle|node|step|ratio|highlight|emphasis|sidebar)\b/gi,
      );
      if (renderingKeywords?.length) {
        const unique = [...new Set(renderingKeywords.map((k: string) => k.toLowerCase()))];
        queryParts.push(unique.join(", "));
      }
    }

    // 테마/스타일
    if (spec.theme?.style) queryParts.push(spec.theme.style);
    if (spec.theme?.mood) queryParts.push(spec.theme.mood);
  } catch {
    // slideSpec이 유효한 JSON이 아닌 경우 무시
  }

  // technique이 하나도 매핑 안 된 경우 전체 검색
  if (allTechniques.size === 0) {
    // 모든 technique을 후보로
    Object.values(LAYOUT_TO_TECHNIQUES)
      .flat()
      .forEach((t) => allTechniques.add(t));
  }

  const queryText =
    queryParts.length > 0
      ? `HTML rendering technique: ${queryParts.join(", ")}`
      : "HTML presentation rendering technique";

  return {
    techniques: [...allTechniques],
    queryText,
  };
}

/**
 * Retrieve References Step
 *
 * plan-slides의 출력(slideSpec)을 받아 Vector DB에서 유사한 HTML 렌더링
 * 테크닉 레퍼런스를 검색한다. slideSpec의 layoutType별로 필요한 technique을
 * 매핑하여 메타데이터 필터링 + 벡터 유사도로 검색.
 *
 * 검색 결과의 fullHtml을 referenceHtmls로 반환하여
 * render-html Step의 프롬프트에 주입된다.
 *
 * Vector DB가 없거나 인덱스가 비어있으면 빈 배열을 반환하고 워크플로우는 정상 진행.
 */
export const retrieveReferencesStep = createStep({
  id: "retrieve-references",
  inputSchema: z.object({
    slideSpec: z.string().optional(),
    userRequest: z.string().optional(),
  }),
  outputSchema: renderLoopIOSchema,
  stateSchema: pptWorkflowStateSchema,
  execute: async ({ inputData, mastra, state, setState }) => {
    const slideSpec = inputData.slideSpec || state?.slideSpec || "";
    const userRequest = inputData.userRequest || state?.userRequest || "";

    let referenceHtmls: string[] = [];

    const pgVector = mastra?.getVector("pgVector");
    if (!pgVector) {
      console.warn("[retrieve-references] pgVector not registered, skipping");
      return buildOutput(inputData, referenceHtmls, state, setState);
    }

    try {
      // 인덱스 존재 여부 확인
      const indexes = await pgVector.listIndexes();
      if (!indexes.includes(INDEX_NAME)) {
        console.warn(
          `[retrieve-references] Index "${INDEX_NAME}" not found, skipping`,
        );
        return buildOutput(inputData, referenceHtmls, state, setState);
      }

      // slideSpec에서 technique 매핑 + 쿼리 구성
      const { techniques, queryText } = buildSearchParams(
        slideSpec,
        userRequest,
      );
      console.log(
        `[retrieve-references] Techniques: [${techniques.join(", ")}]`,
      );
      console.log(
        `[retrieve-references] Query: "${queryText.slice(0, 100)}"`,
      );

      // fastembed로 임베딩 — 동적 import (패키지 미설치 시 graceful 처리)
      let embedding: number[];
      try {
        const { fastembed } = await import("@mastra/fastembed");
        const result = await embed({
          model: fastembed,
          value: queryText,
        });
        embedding = result.embedding;
      } catch (embedErr) {
        console.error(
          "[retrieve-references] Embedding failed:",
          embedErr,
        );
        return buildOutput(inputData, referenceHtmls, state, setState);
      }

      // Vector DB 검색 — technique 필터로 관련 레퍼런스만 조회
      // PgVector의 filter는 exact match이므로, technique별로 개별 쿼리 후 병합
      const seen = new Set<string>();
      const allResults: Array<{
        score: number;
        html: string;
        technique: string;
        variant: string;
      }> = [];

      for (const technique of techniques) {
        try {
          const results = await pgVector.query({
            indexName: INDEX_NAME,
            queryVector: embedding,
            topK: 2,
            filter: { technique },
          });

          for (const r of results) {
            const docId = r.metadata?.documentId as string;
            const html = r.metadata?.fullHtml as string | undefined;
            const variant = (r.metadata?.variant as string) || "default";
            const score = r.score ?? 0;
            if (html && docId && !seen.has(docId) && score >= MIN_SCORE) {
              seen.add(docId);
              allResults.push({ score, html, technique, variant });
            }
          }
        } catch (queryErr) {
          console.warn(
            `[retrieve-references] Query failed for technique="${technique}":`,
            queryErr,
          );
        }
      }

      // 점수 순 정렬 후 상위 TOP_K개 선택
      // 각 HTML 앞에 technique 메타 주석 삽입 → render-html에서 슬라이드별 매핑에 사용
      allResults.sort((a, b) => b.score - a.score);

      // technique → 적용 대상 layoutType 역매핑 구성
      const techniqueToLayouts: Record<string, string[]> = {};
      try {
        const spec = JSON.parse(slideSpec);
        const layouts: string[] =
          spec.slides?.map((s: any) => s.layoutType).filter(Boolean) || [];
        for (const layout of layouts) {
          const techs = LAYOUT_TO_TECHNIQUES[layout] || [];
          for (const t of techs) {
            if (!techniqueToLayouts[t]) techniqueToLayouts[t] = [];
            if (!techniqueToLayouts[t].includes(layout)) {
              techniqueToLayouts[t].push(layout);
            }
          }
        }
      } catch {
        // slideSpec 파싱 실패 시 역매핑 없이 진행
      }

      referenceHtmls = allResults.slice(0, TOP_K).map((r) => {
        const appliesTo = techniqueToLayouts[r.technique] || [];
        const meta = [
          `TECHNIQUE: ${r.technique}`,
          `VARIANT: ${r.variant}`,
          appliesTo.length > 0
            ? `APPLIES TO: ${appliesTo.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");
        return `<!-- ${meta} -->\n${r.html}`;
      });

      console.log(
        `[retrieve-references] Found ${referenceHtmls.length} references (from ${seen.size} unique docs)`,
      );
    } catch (err) {
      console.error("[retrieve-references] Vector query failed:", err);
      // Non-fatal: 참조 없이 계속 진행
    }

    return buildOutput(inputData, referenceHtmls, state, setState);
  },
});

/** state 업데이트 + output 구성 헬퍼 */
function buildOutput(
  inputData: { slideSpec?: string; userRequest?: string },
  referenceHtmls: string[],
  state: any,
  setState: (s: any) => void,
) {
  setState({
    ...state,
    referenceHtmls,
  });

  return {
    slideSpec: inputData.slideSpec,
    userRequest: inputData.userRequest,
    referenceHtmls,
  };
}
