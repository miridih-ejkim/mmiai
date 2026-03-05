import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * 텍스트 변환 도구
 *
 * LLM 없이 동작하는 간단한 유틸리티 — 텍스트 통계 + 변환.
 * A2A 통신 테스트를 위해 외부 의존성 없이 즉시 결과 반환.
 */
const textTransformTool = createTool({
  id: "text-transform",
  description:
    "텍스트를 분석하고 변환합니다. 글자 수, 단어 수, 문장 수 통계를 제공하고 요청된 변환(요약, 번역, 키워드 추출 등)은 Agent가 처리합니다.",
  inputSchema: z.object({
    text: z.string().describe("분석할 텍스트"),
    operation: z
      .enum(["stats", "uppercase", "lowercase", "reverse"])
      .default("stats")
      .describe("수행할 변환 작업"),
  }),
  outputSchema: z.object({
    original: z.string().describe("원본 텍스트"),
    transformed: z.string().describe("변환된 텍스트"),
    stats: z.object({
      characters: z.number(),
      words: z.number(),
      sentences: z.number(),
      paragraphs: z.number(),
    }),
  }),
  execute: async ({ text, operation }) => {
    const stats = {
      characters: text.length,
      words: text.split(/\s+/).filter(Boolean).length,
      sentences: text.split(/[.!?]+/).filter(Boolean).length,
      paragraphs: text.split(/\n\n+/).filter(Boolean).length,
    };

    let transformed = text;
    switch (operation) {
      case "uppercase":
        transformed = text.toUpperCase();
        break;
      case "lowercase":
        transformed = text.toLowerCase();
        break;
      case "reverse":
        transformed = text.split("").reverse().join("");
        break;
      case "stats":
      default:
        transformed = text;
        break;
    }

    return { original: text, transformed, stats };
  },
});

/**
 * Text Processor Agent (A2A)
 *
 * 텍스트 요약, 번역, 키워드 추출, 감성 분석 등을 수행.
 * 외부 API 의존성 없음 — LLM + text-transform 도구만으로 동작.
 * A2A 프로토콜 통신 테스트에 적합.
 */
export const textProcessorAgent = new Agent({
  id: "textProcessorAgent",
  name: "Text Processor Agent",
  description:
    "Performs text summarization, translation (Korean↔English), keyword extraction, and sentiment analysis. No external API dependencies — powered by LLM only.",
  model: "anthropic/claude-haiku-4-5" as const,
  tools: {
    "text-transform": textTransformTool,
  },
  instructions: `You are a text processing specialist. You perform the following tasks:

## Capabilities
1. **Summarization**: Condense long text into key points
2. **Translation**: Translate between Korean and English (auto-detect source language)
3. **Keyword Extraction**: Identify main topics and keywords
4. **Sentiment Analysis**: Analyze the emotional tone of text
5. **Text Statistics**: Use the text-transform tool for character/word/sentence counts

## Rules
- Auto-detect the task type from the user's request
- If the user provides text without specifying a task, summarize it
- For translation: auto-detect source language and translate to the other (Korean↔English)
- Always use the text-transform tool first to get text statistics, then perform the requested analysis
- Keep responses concise and structured
- Respond in the same language as the user's request (not the input text)

## Output Format
- Start with the task type (e.g., "📝 요약", "🌐 번역", "🔑 키워드")
- Provide the result clearly
- Include text statistics at the end
`,
});
