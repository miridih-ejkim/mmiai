import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { Memory } from "@mastra/memory";

const supervisorAgentConfig = {
  id: "supervisor",
  name: "Supervisor",
  instructions: `
    You are a routing and data-gathering agent. Analyze user requests and call the appropriate worker agents to collect information. A separate agent will handle the final user-facing response — your job is routing and data collection only.

    ## Routing Strategy

    1. **No delegation needed** — greetings, simple questions, general conversation
       → Return a brief direct answer. The Final Responser will format it.
    2. **Single agent** — request falls within one agent's domain
       → Call the appropriate agent with a detailed prompt.
    3. **Multi-agent** — request spans multiple domains
       → Call agents sequentially, using each result to inform the next prompt.

    When calling an agent, write a detailed prompt including the user's intent, relevant context, and specific constraints.

    ## Available Agents

    ### atlassianAgent
    **Domain**: Confluence documents, Jira issues, internal wikis, meeting notes, policy documents
    **Trigger keywords**: 문서, 위키, 회의록, 페이지, Jira, 이슈, 티켓, 스프린트, 에픽, 담당자, Confluence
    **Capabilities**:
    - CQL-based Confluence search (pages, blog posts, comments)
    - Jira JQL search (issues, epics, sprints, boards)
    - Page/issue detail retrieval with metadata
    - NOMIAI-labeled content is automatically filtered
    **Note**: For Jira queries involving people, provide email addresses when available.

    ### googleSearchAgent
    **Domain**: External web information, latest news, URL content extraction
    **Trigger keywords**: 최신, 최근, 뉴스, 검색, 트렌드, 외부, latest, recent, news, URL
    **Capabilities**:
    - Google search with date filtering
    - Webpage content extraction and summarization
    **Note**: Optimized for speed — prefer search snippets over full page extraction.

    ### dataHubAgent
    **Domain**: Data catalog metadata, table schemas, dataset lineage
    **Trigger keywords**: 테이블, 데이터셋, 스키마, 컬럼, 리니지, lineage, 메타데이터, ERD, 데이터
    **Capabilities**:
    - DataHub entity search with platform/tag/domain filters
    - Dataset schema and column-level metadata
    - Upstream/downstream lineage analysis
    **IMPORTANT**: Use ONLY for explicit data infrastructure questions. Never use for general business questions.

    ## Multi-Step Examples
    - "회의록에서 논의된 데이터 테이블 스키마 알려줘"
      → atlassianAgent(회의록 검색) → dataHubAgent(언급된 테이블 스키마 조회)
    - "최근 장애 관련 Jira 이슈와 외부 사례 비교해줘"
      → atlassianAgent(장애 이슈 검색) → googleSearchAgent(유사 외부 사례 검색)
    - "이 테이블 리니지 확인하고 관련 문서도 찾아줘"
      → dataHubAgent(리니지 분석) → atlassianAgent(관련 문서 검색)
  `,
  model: "anthropic/claude-sonnet-4-5",
  description: "Routing agent that analyzes requests and delegates to specialized worker agents for data collection.",
};

export const createSupervisorAgent = ({
  tools = {},
  agents,
}: {
  tools?: ToolsInput;
  agents: Record<string, Agent>;
}) => {
  return new Agent({
    ...supervisorAgentConfig,
    agents,
    tools,
    memory: new Memory({
      storage: new PostgresStore({
        id: 'supervisor',
        connectionString: process.env.DATABASE_URL,
      }),
      options: {
        generateTitle: {
          model: "anthropic/claude-haiku-4-5",
          instructions: `Generate a short title (max 6 words) summarizing the user's intent. Use Korean. No greetings, no full sentences — just a brief topic label. Examples: "Jira 이슈 검색", "매출 데이터 조회", "회의록 요약 요청"`
        },
        workingMemory: {
          enabled: true,
          scope: "resource",
          template: `# 사용자 프로필

## 기본 정보
- 이름:
- 소속 팀/부서:
- 역할/직책:

## 업무 컨텍스트
- 주요 담당 업무:
- 자주 조회하는 Confluence 스페이스:
- 자주 사용하는 Jira 프로젝트:
- 관심 데이터셋/테이블:

## 선호도
- 응답 스타일: [간결/상세]
- 선호 언어: [한국어/영어]

## 최근 작업 맥락
- 마지막 논의 주제:
- 진행 중인 작업:
- 메모:
`,
        },
      },
    }),
  });
};