/**
 * PPT HTML 마커 유틸리티
 *
 * 메시지 텍스트에 PPT HTML을 base64로 임베딩하여 DB에 저장/복원한다.
 * 마커 형식: <!--MMIAI_PPT:base64data-->
 */

const PPT_MARKER_RE = /<!--MMIAI_PPT:([\s\S]+?)-->/;

/** HTML을 base64 마커로 인코딩하여 텍스트에 임베딩 */
export function embedPptHtml(summaryText: string, html: string): string {
  const encoded = Buffer.from(html, 'utf-8').toString('base64');
  return `${summaryText}\n<!--MMIAI_PPT:${encoded}-->`;
}

/** 메시지 텍스트에서 PPT HTML 추출 (없으면 null) */
export function extractPptHtml(text: string): string | null {
  const match = text.match(PPT_MARKER_RE);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

/** 메시지 텍스트에서 PPT 마커를 제거하고 표시용 텍스트만 반환 */
export function stripPptMarker(text: string): string {
  return text.replace(PPT_MARKER_RE, '').trim();
}

/** 메시지 텍스트에 PPT 마커가 있는지 확인 */
export function hasPptMarker(text: string): boolean {
  return PPT_MARKER_RE.test(text);
}

/** 클라이언트에서 사용할 수 있는 base64 → UTF-8 디코더 (브라우저 호환) */
export function extractPptHtmlClient(text: string): string | null {
  const match = text.match(PPT_MARKER_RE);
  if (!match) return null;
  try {
    // atob()은 Latin1만 처리하므로 UTF-8 멀티바이트 문자가 깨짐
    // binary string → Uint8Array → TextDecoder(utf-8)로 올바르게 디코딩
    const binaryString = atob(match[1]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}
