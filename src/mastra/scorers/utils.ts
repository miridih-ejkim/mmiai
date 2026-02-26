/**
 * Scorer 공유 유틸리티
 *
 * 한국어/영어 stop words 필터링 + 키워드 추출 함수.
 * quality-scorer에서 사용.
 */

/** 한국어 stop words (조사, 어미, 대명사 등) */
const STOP_WORDS_KO = new Set([
  "은", "는", "이", "가", "을", "를", "의", "에", "에서", "로", "으로",
  "와", "과", "도", "만", "부터", "까지", "한", "그", "저", "좀",
  "해줘", "알려줘", "해", "해주세요", "뭐", "어떤", "좀", "다",
  "있는", "없는", "하는", "되는", "된", "할", "수", "것", "거",
]);

/** 영어 stop words */
const STOP_WORDS_EN = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "like",
  "through", "after", "between", "out", "and", "or", "but", "not", "no",
  "if", "then", "so", "it", "its", "this", "that", "what", "which",
  "who", "how", "me", "my", "we", "our", "you", "your", "they", "them",
  "their", "he", "she", "his", "her",
]);

/**
 * 텍스트에서 의미 있는 키워드 추출
 *
 * - 소문자화
 * - 공백/구두점 기준 토큰 분리
 * - 1자 이하 토큰 제거
 * - 한국어/영어 stop words 제거
 * - 중복 제거
 */
export function extractKeywords(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const tokens = text
    .toLowerCase()
    .split(/[\s,.!?;:()[\]{}""''·…\-/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

  const keywords = tokens.filter(
    (t) => !STOP_WORDS_KO.has(t) && !STOP_WORDS_EN.has(t),
  );

  return [...new Set(keywords)];
}

