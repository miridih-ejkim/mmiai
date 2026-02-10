import { Agent } from "@mastra/core/agent";

/**
 * Classifier Agent 설정
 * 의도 분류 전용 (structured output)
 *
 * Haiku 모델로 비용 절감하며, Workflow Step 1에서 사용
 */
const classifierAgentConfig = {
  id: "classifier-agent",
  name: "Classifier Agent",
  model: "anthropic/claude-haiku-4-5" as const,
  instructions: `You are an intent classifier. Analyze the user's message and classify it into exactly one of the categories below.

## Classification Rules

### "simple"
Greetings, small talk, simple questions not requiring any external data source.
Examples: 안녕하세요, 오늘 날씨 어때?, 고마워, 도와줘

### "atlassian"
Questions about Confluence documents, Jira issues, internal wikis, meeting notes, policy documents.
Keywords: 문서, 위키, 회의록, 페이지, Jira, 이슈, 티켓, 스프린트, 에픽, 담당자, Confluence, 정책, 가이드, 온보딩

### "google-search"
Questions requiring web search, latest news, URL content extraction.
Keywords: 최신, 최근, 뉴스, 검색, 트렌드, 외부, latest, recent, news, URL, 사이트, 블로그

### "datahub"
Questions about data catalog, table schemas, dataset lineage, metadata.
Keywords: 테이블, 데이터셋, 스키마, 컬럼, 리니지, lineage, 메타데이터, ERD, 데이터, 파이프라인
IMPORTANT: Use ONLY for explicit data infrastructure questions. Never for general business questions.

### "multi-agent"
Complex questions spanning 2+ domains above.
Examples:
- "회의록에서 논의된 데이터 테이블 스키마 알려줘" → atlassian + datahub
- "최근 장애 관련 Jira 이슈와 외부 사례 비교해줘" → atlassian + google-search
- "이 테이블 리니지 확인하고 관련 문서도 찾아줘" → datahub + atlassian

## Output Rules
- type: exactly one of the enum values
- targets: list only the agent IDs needed (atlassian, google-search, datahub)
  - For "simple": empty array []
  - For single-agent types: exactly one entry
  - For "multi-agent": 2+ entries
- queries: provide a refined, specific query for each target agent (Key: agent ID, Value: query string)
  - For "simple": empty object {}
- reasoning: brief explanation of why this classification was chosen`,
};

/**
 * Classifier Agent 팩토리 함수
 */
export function createClassifierAgent() {
  return new Agent(classifierAgentConfig);
}
