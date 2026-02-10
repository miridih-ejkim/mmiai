# CLAUDE.md

## 프로젝트 개요

Mastra 기반 Multi-Agent AI 애플리케이션 (MMIAI)

LangGraph 단일 Agent → Mastra Agent Network → **Mastra Workflow** 구조로 진화한 프로젝트.
Workflow가 사용자 요청을 구조화된 Step으로 처리하는 **Deterministic Workflow 패턴**.

**Mastra Agent Server**와 **Next.js UI**가 분리 배포/스케일링 가능한 구조.

## 기술 스택

- **Runtime**: Node.js >= 22.13.0
- **Framework**: Next.js 16 (App Router) - UI Only
- **Agent Server**: Mastra Server (port 4111)
- **Agent Framework**: Mastra (Workflow 패턴)
- **MCP**: @mastra/mcp (Model Context Protocol 통합)
- **Language**: TypeScript (ES2022, ESM)
- **LLM**: Anthropic Claude Sonnet 4.5 (`anthropic/claude-sonnet-4-5`)
- **UI**: React 19, Tailwind CSS 4, shadcn/ui
- **AI SDK**: ai v6, @ai-sdk/react, @mastra/ai-sdk
- **Storage**: @mastra/libsql (in-memory)
- **Observability**: @mastra/observability (DefaultExporter + CloudExporter)

## 배포 아키텍처

```
Browser
  │
  ▼
Next.js (UI Only, port 3000)
  │  /mastra/* → rewrite
  ▼
Mastra Agent Server (port 4111)
  │  workflowRoute("/chat")
  │  registerApiRoute("/chat-history")
  │
  ├── Chat Workflow
  │     ├── Step 1: Intent Classification (structured output)
  │     ├── Step 2: .branch() → Agent Steps / Multi-Agent Sub-Workflow
  │     └── Step 3: Response Synthesis
  │
  ├── Worker Agents
  │     ├── AtlassianAgent → MCP (HTTP)
  │     ├── GoogleSearchAgent → MCP (stdio)
  │     └── DataHubAgent → MCP (HTTP)
  │
  └── google-search-mcp/ (stdio 프로세스)
```

### 핵심 원칙
- **같은 코드베이스**, 두 개의 빌드 타겟
- `mastra build` → Agent Server Docker 이미지
- `next build` → UI Docker 이미지
- Next.js에서 Mastra 직접 import 제거 → HTTP 통신 (rewrite 프록시)

## 프로젝트 구조

```
mmiai/
├── google-search-mcp/          # Google Search MCP 서버 (로컬 stdio)
│   ├── google-search.js        # 커스텀 MCP 서버 구현
│   └── node_modules/           # MCP 서버 의존성
├── src/
│   ├── app/                    # Next.js App Router (UI Only)
│   │   ├── chat/page.tsx       # Chat UI 페이지
│   │   ├── layout.tsx          # Root 레이아웃
│   │   └── page.tsx            # 홈페이지
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 기본 컴포넌트
│   │   └── ai-elements/        # AI 관련 UI 컴포넌트
│   ├── lib/
│   │   └── utils.ts            # 유틸리티 함수
│   └── mastra/                 # Mastra Agent 설정 (Server 전용)
│       ├── index.ts            # top-level await, mastra export
│       ├── init.ts             # initializeMastra() - Workflow/Agent/Mastra 설정
│       ├── mcp/
│       │   └── client.ts       # MCPClient 설정 (하이브리드 HTTP/stdio)
│       ├── workflows/          # Workflow 정의
│       │   ├── chat-workflow.ts       # 메인 Chat Workflow
│       │   └── steps/                 # Workflow Steps
│       │       ├── classify-intent.ts # 의도 분류 Step
│       │       ├── agent-steps.ts     # Agent 실행 Steps
│       │       ├── merge-results.ts   # 결과 병합 Step
│       │       └── synthesize.ts      # 최종 응답 합성 Step
│       └── agents/
│           ├── classifier-agent.ts    # 의도 분류 전용 Agent (Haiku)
│           ├── final-responser/       # 최종 응답 합성 Agent
│           └── workers/               # Worker Agents
│               ├── index.ts
│               ├── atlassian-agent.ts
│               ├── google-search-agent.ts
│               └── datahub-agent.ts
├── docs/
│   └── workflow-migration-analysis.md  # Workflow 전환 분석 문서
├── Dockerfile.server
├── Dockerfile.web
├── docker-compose.yml
├── next.config.ts
├── mcp-config.json
├── package.json
└── tsconfig.json
```

## Workflow 아키텍처

### 전체 흐름

```
User Message
     │
     ▼
┌────────────────┐
│ 1. Classify    │  ← Haiku (비용 절감, structured output)
│ Intent & Route │  → { type, targets[], queries{} }
└───────┬────────┘
        │
   ┌────┴──── .branch() ────────────────────┐
   │         (결정적 분기)                     │
   ▼              ▼              ▼           ▼
┌──────┐   ┌──────────┐   ┌─────────┐  ┌──────────────┐
│Simple│   │Single    │   │Single   │  │Multi-Agent   │
│직접   │   │Agent     │   │Agent    │  │.parallel()   │
│응답   │   │(ATL/DHB) │   │(GGL)    │  │┌───┬───┬───┐ │
└──┬───┘   └────┬─────┘   └───┬─────┘  ││ATL│GGL│DHB│ │
   │            │              │        │└─┬─┴─┬─┴─┬─┘ │
   │            │              │        │  └───┼───┘   │
   │            │              │        │  Merge Step  │
   │            │              │        └──────┬───────┘
   └────────────┴──────────────┴───────────────┘
                       │
                  .map() (출력 정규화)
                       │
                       ▼
              ┌─────────────────┐
              │ Final: Response │  ← Agent (Haiku)
              │ Synthesis       │  ← 결과 통합 전용
              └─────────────────┘
                       │
                       ▼
                  User Response
```

### 설계 원칙

| 원칙 | 구현 방식 |
|------|----------|
| 라우팅 | 구조화된 분류 + `.branch()` (결정적) |
| 데이터 흐름 | Zod 스키마 검증 (Step 간 타입 안전) |
| 병렬 실행 | `.parallel()` 명시적 제어 |
| 에러 처리 | Step 단위 try/catch + 재시도 |
| 관측성 | Step별 input/output 자동 추적 |

### Workflow Steps

| Step | 역할 | 모델 | 설명 |
|------|------|------|------|
| `classify-intent` | 의도 분류 | Haiku | structured output으로 type/targets/queries 반환 |
| `direct-response` | 직접 응답 | Haiku | 인사말 등 단순 질문 직접 처리 |
| `atlassian-agent` | Confluence/Jira | Haiku | MCP(HTTP)로 사내 문서/이슈 검색 |
| `google-search-agent` | 웹 검색 | Haiku | MCP(stdio)로 Google 검색/콘텐츠 추출 |
| `datahub-agent` | 데이터 카탈로그 | Haiku | MCP(HTTP)로 메타데이터/리니지 조회 |
| `merge-results` | 결과 병합 | - | Multi-Agent 병렬 결과 통합 (로직만) |
| `synthesize-response` | 최종 응답 | Haiku | 검색 결과 기반 사용자 응답 생성 |

### 라우팅 규칙

| 분류 type | 대상 | 키워드/패턴 |
|-----------|------|------------|
| `simple` | 직접 응답 | 인사말, 단순 질문 |
| `atlassian` | AtlassianAgent | Confluence, Jira, 문서, 이슈, 위키, 회의록 |
| `google-search` | GoogleSearchAgent | 최신, 최근, 뉴스, 검색, URL 요약 |
| `datahub` | DataHubAgent | 테이블, 데이터셋, 스키마, 리니지, lineage |
| `multi-agent` | 병렬 실행 | 복합 질문 (2개 이상 도메인) |

## MCP 아키텍처 (하이브리드)

### 연결 방식

| MCP 서버 | 연결 방식 | 위치 | 확장성 |
|----------|----------|------|--------|
| Atlassian (Confluence + Jira) | Streamable HTTP | 외부 Kubernetes 서비스 | HPA 자동 확장 |
| DataHub | Streamable HTTP | 외부 Kubernetes 서비스 | HPA 자동 확장 |
| Google Search | stdio | 로컬 (`google-search-mcp/`) | Agent Server 인스턴스와 함께 |

### 인프라 구조

```
┌──────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                    │
│                                                        │
│  ┌──────────────┐     ┌──────────────────────────┐    │
│  │  Next.js UI   │     │  Mastra Agent Server      │    │
│  │  (port 3000)  │ HTTP│  (port 4111)              │    │
│  │  /mastra/* ───┼────►│  networkRoute("/chat")    │    │
│  │  rewrite      │     │  registerApiRoute(...)    │    │
│  └──────────────┘     │                          │    │
│                        │  MCPClient               │    │
│                        │  - atlassian ──► HTTP    │    │
│                        │  - datahub   ──► HTTP    │    │
│                        │  - google    ──► stdio   │    │
│                        └──────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Mastra Server 라우트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/chat` | POST | Workflow 스트리밍 (run.stream(), useChat 호환) |
| `/chat-history` | GET | 대화 기록 조회 (registerApiRoute) |

> 참고: `/api/*` 경로는 Mastra 내부 예약 (agents, workflows 등)

## 초기화 흐름

```
src/mastra/index.ts (top-level await)
  └── initializeMastra()
        ├── mcpClient.listTools()           # MCP 도구 로드
        ├── createAtlassianAgent(tools)      # Worker Agent 생성
        ├── createGoogleSearchAgent(tools)
        ├── createDataHubAgent(tools)
        ├── createClassifierAgent()          # 의도 분류 Agent 생성
        ├── createFinalResponserAgent()      # 최종 응답 Agent 생성
        ├── chatWorkflow.commit()            # Workflow 구성 확정
        └── new Mastra({
              agents: {...},
              workflows: { chatWorkflow },
              server: { apiRoutes: [...] }
            })
```

- top-level await로 서버 시작 시 즉시 초기화
- Worker Agent는 팩토리 함수로 MCP 도구 주입받아 생성
- Workflow는 `createWorkflow()` → `.then()` / `.branch()` / `.parallel()` → `.commit()`으로 구성

## 환경변수

```env
# ===== LLM =====
ANTHROPIC_API_KEY=your-anthropic-api-key

# ===== MCP 서버 URL (Kubernetes) =====
MCP_ATLASSIAN_URL=http://atlassian-mcp:8080/mcp
MCP_DATAHUB_URL=http://datahub-mcp:8080/mcp
MCP_AUTH_TOKEN=optional-auth-token

# ===== Google Search (로컬 stdio) =====
GOOGLE_API_KEY=your-google-api-key
GOOGLE_SEARCH_ENGINE_ID=your-search-engine-id

# ===== Next.js UI → Mastra Server 연결 =====
MASTRA_SERVER_URL=http://localhost:4111    # 로컬
# MASTRA_SERVER_URL=http://mastra-server:4111  # Kubernetes
```

## 주요 명령어

```bash
# === 개발 (터미널 2개) ===
npm run mastra:dev   # 터미널 1: Mastra Agent Server (port 4111, Studio 포함)
npm run dev          # 터미널 2: Next.js UI (port 3000)

# === 빌드 ===
npm run mastra:build # Mastra Agent Server 빌드
npm run build        # Next.js UI 빌드

# === 프로덕션 ===
npm run mastra:start # Mastra Agent Server 시작
npm run start        # Next.js UI 시작

# === Docker ===
docker compose up --build  # 로컬 Docker 테스트
```

## 확장 방법

### Worker Agent 추가
1. `src/mastra/agents/workers/`에 Agent 파일 생성 (팩토리 패턴)
   - `createXxxAgent(tools: ToolsInput)` 팩토리 함수 export
   - `xxxAgent` 기본 인스턴스 export (테스트/개발용)
2. `src/mastra/agents/workers/index.ts`에 export 추가
3. `src/mastra/workflows/steps/agent-steps.ts`에 Agent Step 추가
4. `src/mastra/workflows/chat-workflow.ts`에서:
   - `classify-intent` Step의 분류 type에 새 Agent 추가
   - `.branch()` 조건에 새 분기 추가
   - Multi-Agent `.parallel()`에 새 Agent Step 추가
5. `src/mastra/init.ts`의 `initializeMastra()`에서:
   - 팩토리 함수로 Agent 생성 (MCP 도구 주입)
   - Mastra의 `agents` 객체에 등록

### MCP 서버 추가
1. `src/mastra/mcp/client.ts`의 servers에 MCP 서버 설정 추가
   - HTTP 서버: `url: new URL("http://...")`
   - stdio 서버: `command: "...", args: [...]`
2. Worker Agent에서 해당 도구 사용

### Workflow Step 추가
1. `src/mastra/workflows/steps/`에 Step 파일 생성
   - `createStep({ id, inputSchema, outputSchema, execute })`
2. `chat-workflow.ts`에서 적절한 위치에 `.then()` / `.branch()` / `.parallel()`로 연결
3. 전후 Step의 스키마 호환성 확인 (필요시 `.map()`으로 변환)

## 주요 비즈니스 규칙

### NOMIAI 레이블 필터링 (AtlassianAgent)
- 모든 Confluence CQL 쿼리에 `label NOT IN ("NOMIAI")` 필수 포함
- 페이지 조회 전 `confluence_get_labels`로 레이블 검증
- NOMIAI 페이지 접근 시 "접근이 제한된 콘텐츠입니다"로 안내

### Jira JQL 규칙 (AtlassianAgent)
- 이메일 주소는 큰따옴표 필수: `assignee = "user@example.com"`
- Boolean 연산자 대문자: AND, OR, NOT
- component 필드: `=` 또는 `IN`만 사용 (`~` 사용 불가)

### DataHubAgent 사용 조건
- 명시적 데이터 관련 질문에만 사용 (테이블, 스키마, 리니지)
- 일반 비즈니스 질문에는 사용 금지
