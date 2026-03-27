/**
 * Infographic HTML Reference Ingestion Script
 *
 * HTML 렌더링 테크닉 레퍼런스를 Vector DB에 인덱싱한다.
 * - 파일명 컨벤션: {technique}--{variant}.html
 * - LLM(Haiku)으로 영어 caption 생성 (렌더링 기법 중심)
 * - fastembed로 caption 임베딩
 * - PgVector에 upsert (fullHtml은 metadata에 저장)
 *
 * Usage:
 *   npx tsx scripts/ingest-infographics.ts <html-directory>
 *
 * Required env:
 *   DATABASE_URL — PostgreSQL connection string (pgvector extension 필요)
 *   ANTHROPIC_API_KEY — caption 생성용
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { PgVector } from "@mastra/pg";
import { embed } from "ai";
import { fastembed } from "@mastra/fastembed";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const INDEX_NAME = "infographic_references";
const DIMENSION = 384; // fastembed bge-small-en-v1.5

/**
 * Caption 프롬프트 — "어떤 렌더링 기법을 보여주는가" 관점
 *
 * 기술적 CSS 묘사가 아닌, Renderer Agent가 검색할 때 매칭되는
 * "이 레퍼런스는 어떤 시각화 문제를 해결하는가" 관점으로 작성.
 */
const CAPTION_PROMPT = `You are analyzing an HTML component used as a rendering technique reference for an AI presentation generator.

Describe in 2-3 English sentences what RENDERING TECHNIQUE this component demonstrates, focusing on:
- What visual composition problem it solves (e.g., "connecting nodes with lines", "splitting a slide into proportional sections")
- The specific CSS/HTML approach used (e.g., "absolute-positioned vertical line with z-indexed circular nodes", "CSS grid with fr units for precise ratio control")
- What kind of presentation slide would benefit from this technique (e.g., "process flow slides", "KPI dashboard slides")

Do NOT describe the content (what the text says). Focus on HOW it renders visual elements.

HTML:
`;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      "Usage: npx tsx scripts/ingest-infographics.ts <html-directory>",
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // 1. PgVector 초기화
  const pgVector = new PgVector({
    id: "ingest-vector",
    connectionString,
  });

  // 2. 인덱스 생성 (idempotent)
  await pgVector.createIndex({
    indexName: INDEX_NAME,
    dimension: DIMENSION,
    metric: "cosine",
    indexConfig: { type: "hnsw", hnsw: { m: 8, efConstruction: 32 } },
  });
  console.log(`Index "${INDEX_NAME}" ready (dim=${DIMENSION}, HNSW)`);

  // 3. HTML 파일 목록
  const absDir = resolve(dir);
  const files = (await readdir(absDir)).filter((f) => f.endsWith(".html"));
  console.log(`Found ${files.length} HTML files in ${absDir}\n`);

  if (files.length === 0) {
    console.warn("No .html files found. Exiting.");
    await pgVector.disconnect();
    return;
  }

  // 4. LLM 초기화 (caption 생성용)
  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  let successCount = 0;

  for (const file of files) {
    const filePath = resolve(absDir, file);
    const html = await readFile(filePath, "utf-8");
    const docId = basename(file, ".html");

    console.log(`[${successCount + 1}/${files.length}] ${file}`);

    try {
      // 4a. LLM으로 영어 caption 생성 (렌더링 기법 중심)
      const captionResult = await generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt: `${CAPTION_PROMPT}${html.slice(0, 15000)}\n\nReturn ONLY the description, no prefix or formatting.`,
        maxOutputTokens: 300,
      });
      const caption = captionResult.text.trim();
      console.log(`  Caption: ${caption.slice(0, 120)}...`);

      // 4b. 파일명에서 메타데이터 파싱 + HTML 분석
      const metadata = extractMetadata(docId, html, caption);

      // 4c. caption 임베딩
      const { embedding } = await embed({
        model: fastembed,
        value: caption,
      });

      // 4d. PgVector upsert
      await pgVector.upsert({
        indexName: INDEX_NAME,
        vectors: [embedding],
        metadata: [metadata],
        ids: [docId],
      });

      successCount++;
      console.log(
        `  technique=${metadata.technique} variant=${metadata.variant}`,
      );
      console.log(`  Upserted: ${docId}\n`);
    } catch (err) {
      console.error(
        `  FAILED: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  console.log(
    `\nDone! Ingested ${successCount}/${files.length} files into "${INDEX_NAME}"`,
  );
  await pgVector.disconnect();
}

/**
 * 파일명 파싱 + HTML 분석으로 메타데이터를 추출한다.
 *
 * 파일명 컨벤션: {technique}--{variant}.html
 * 예: "node-connector--flex-svg-arrow" → technique="node-connector", variant="flex-svg-arrow"
 */
function extractMetadata(
  docId: string,
  html: string,
  caption: string,
): Record<string, any> {
  // 파일명에서 technique + variant 파싱
  const parts = docId.split("--");
  const technique = parts[0] || "unknown";
  const variant = parts[1] || "default";

  // HTML에서 사용된 핵심 CSS 패턴 추출
  const cssPatterns = extractCssPatterns(html);

  return {
    documentId: docId,
    source: "curated",
    text: caption,
    fullHtml: html,

    // 핵심 분류 (필터링 가능)
    technique,
    variant,

    // 검색 보조
    cssPatterns,
    colorScheme: detectColorScheme(html),
  };
}

/** HTML에서 사용된 주요 CSS 패턴을 추출 */
function extractCssPatterns(html: string): string[] {
  const patterns: string[] = [];
  const lower = html.toLowerCase();

  if (lower.includes("grid")) patterns.push("grid");
  if (lower.includes("flex")) patterns.push("flex");
  if (lower.includes("absolute") || lower.includes("relative"))
    patterns.push("positioning");
  if (lower.includes("<svg")) patterns.push("svg");
  if (lower.includes("gap-")) patterns.push("gap");
  if (lower.includes("aspect-")) patterns.push("aspect-ratio");
  if (
    lower.includes("border-l") ||
    lower.includes("border-t") ||
    lower.includes("w-px") ||
    lower.includes("h-px")
  )
    patterns.push("border-connector");
  if (lower.includes("bg-gradient") || lower.includes("linear-gradient"))
    patterns.push("gradient");
  if (lower.includes("rounded-full")) patterns.push("circle");
  if (lower.includes("row-reverse")) patterns.push("row-reverse");

  return patterns;
}

/** 색상 테마 감지 */
function detectColorScheme(html: string): "dark" | "light" | "colored" {
  const lower = html.toLowerCase();
  if (
    lower.includes("bg-slate-900") ||
    lower.includes("bg-gray-900") ||
    lower.includes("bg-black")
  )
    return "dark";
  if (
    lower.includes("bg-white") ||
    lower.includes("bg-gray-50") ||
    lower.includes("bg-gray-100")
  )
    return "light";
  return "colored";
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
