# CLAUDE.md

## 프로젝트 개요

Mastra 기반 Multi-Agent AI 애플리케이션 (MMIAI)

LangGraph 단일 Agent → Mastra Agent Network → **Mastra Workflow** 구조로 진화한 프로젝트.
Workflow가 사용자 요청을 구조화된 Step으로 처리하는 **Deterministic Workflow + Planner 패턴**.

**Mastra Agent Server**와 **Next.js UI**가 분리 배포/스케일링 가능한 구조.
MCP Registry 기반 동적 확장 — Worker Agent/MCP 추가 시 Workflow Step/Branch 수정 불필요.

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
- **Storage**: @mastra/pg (PostgresStore, DATABASE_URL)
- **Observability**: @mastra/observability (DefaultExporter + SensitiveDataFilter)

## 배포 아키텍처

```
Browser
  │
  ▼
Next.js (UI Only, port 3000)
  │  /mastra/* → rewrite
  ▼
Mastra Agent Server (port 4111)
  │  registerApiRoute("/chat")       ← suspend/resume 지원
  │  registerApiRoute("/chat-history")
  │
  ├── Chat Workflow (Deterministic + Planner + HITL)
  │     ├── Step 1: classify-intent (Planner — 의도 분류 + 실행 계획)
  │     ├── Step 2: .branch(simple | agent) → 2분기
  │     ├── Step 3: .map() → 출력 정규화
  │     ├── Step 4: quality-check → suspend/resume (HITL)
  │     └── Step 5: synthesize-response
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
│       ├── mcp/
│       │   ├── index.ts               # MCP 오케스트레이션 (exports)
│       │   ├── mcp-registry.ts        # Admin MCP Registry (서버 정의 + builder)
│       │   ├── connection-manager.ts   # Lazy MCPClient 캐시 (5분 TTL)
│       │   ├── user-activation.ts     # Per-user MCP 활성화 상태 (PostgreSQL)
│       │   ├── client.ts              # MCPClient 설정 (하이브리드 HTTP/stdio)
│       │   ├── server.ts              # MCPServer 생성 (서비스별 분리)
│       │   └── datahub-fallback-tools.ts  # DataHub 재귀 스키마 fallback
│       ├── workflows/          # Workflow 정의
│       │   ├── chat-workflow.ts       # 메인 Chat Workflow (2분기)
│       │   └── steps/                 # Workflow Steps
│       │       ├── classify-intent.ts # Planner Step (의도 분류 + 실행 계획)
│       │       ├── agent-steps.ts     # 통합 Agent Step (single/multi 동적)
│       │       ├── quality-check.ts   # 품질 검증 Step (HITL suspend/resume)
│       │       └── synthesize-response.ts  # 최종 응답 합성 Step
│       └── agents/
│           ├── classifier-agent.ts    # 의도 분류 + 실행 계획 Agent (Haiku)
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
┌─────────────────────┐
│ 1. Planner          │  ← Haiku (비용 절감, structured output)
│ (classify-intent)   │  → { type, targets[], queries{}, executionMode }
│                     │  sequential일 때: queries에 goal/contextHint 포함
└─────────┬───────────┘
          │
     ┌────┴──── .branch() ────────┐
     │       (2분기: simple|agent) │
     ▼                             ▼
┌──────────┐              ┌────────────────┐
│  Simple  │              │  Agent Step    │
│  직접 응답 │              │  (통합)         │
│          │              │                │
└────┬─────┘              │ targets=1:     │
     │                    │  Single 호출    │
     │                    │                │
     │                    │ targets=2+:    │
     │                    │  parallel →    │
     │                    │    Promise.all │
     │                    │  sequential →  │
     │                    │    loop + goal │
     │                    │    /contextHint│
     │                    └───────┬────────┘
     └────────────────────────────┘
                       │
                  .map() (출력 정규화)
                       │
                       ▼
              ┌─────────────────┐
              │ Quality Check   │  ← 규칙 기반 품질 평가 (LLM 호출 없음)
              │ (HITL Gate)     │  ← score < threshold → suspend
              └───────┬─────────┘
                      │
              ┌───────┴────────┐
              │                │
         통과              suspend
              │           (refine/reroute/new)
              │                │
              │         resume() or 새workflow
              │                │
              └───────┬────────┘
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
| 라우팅 | Planner (의도 분류 + 실행 계획) + `.branch()` 2분기 |
| 데이터 흐름 | Zod 스키마 검증 (Step 간 타입 안전) |
| 병렬/순차 | `executionMode`로 선언적 제어 (parallel/sequential) |
| Sequential 맥락 | `goal` + `contextHint`로 단계 간 구조화된 컨텍스트 전달 |
| HITL | `suspend()` / `resume()` (quality-check Step) |
| 동적 확장 | MCP Registry 기반 — Agent/MCP 추가 시 Step/Branch 수정 불필요 |
| 에러 처리 | Step 단위 try/catch + 재시도 |
| 관측성 | Step별 input/output 자동 추적 |

### Workflow Steps

| Step | 역할 | 모델 | 설명 |
|------|------|------|------|
| `classify-intent` | Planner (의도 분류 + 실행 계획) | Haiku | `type`/`targets`/`queries`/`executionMode` 반환. sequential 시 `goal`/`contextHint` 포함 |
| `direct-response` | 직접 응답 | - | 인사말 등 단순 질문, 분류 reasoning을 content로 전달 |
| `agent-step` | 통합 Agent 실행 | Haiku | Registry 기반 동적 Agent 호출. 1개=single, 2개+=parallel/sequential |
| `quality-check` | 품질 검증 (HITL) | - | 규칙 기반 점수 평가, 실패 시 suspend → 라디오 버튼 UI (refine/reroute/new) |
| `synthesize-response` | 최종 응답 | Haiku | 검색 결과 기반 사용자 응답 생성 |

### 라우팅 규칙

| 분류 type | 대상 | 설명 |
|-----------|------|------|
| `simple` | 직접 응답 | 인사말, 단순 질문 (외부 데이터 불필요) |
| `agent` | Agent Step | 1개 이상의 MCP Worker 호출. targets 배열로 동적 결정 |

`[AVAILABLE AGENTS]`가 동적으로 프롬프트에 주입되므로 MCP 추가 시 분류 규칙 자동 확장.

### Sequential Planning (Planner 강화)

sequential 모드에서 각 target의 query가 `{ query, goal, contextHint }` 객체로 확장됩니다:

| 필드 | 설명 | 예시 |
|------|------|------|
| `query` | Agent에게 전달할 기본 쿼리 | "데이터 관련 문서 검색" |
| `goal` | 이 단계가 달성해야 할 목표 | "문서에서 테이블/데이터셋 이름 추출" |
| `contextHint` | 이전 결과에서 참고할 정보 (2번째+ 단계) | "테이블 이름, URN" |

**예시**: `"Confluence에서 데이터 문서 찾고, 거기서 나온 테이블을 DataHub에서 조회해줘"`
```
Step 1 (atlassian): goal="문서를 찾고 테이블 이름 추출"
Step 2 (datahub):   goal="테이블 상세 정보 확인", contextHint="테이블 이름, URN"
```

parallel/single 모드에서는 기존처럼 plain string query 유지 (하위 호환).

## Human-in-the-Loop (HITL)

### 구조

`quality-check` Step이 suspend/resume 게이트 역할.
suspend 시 라디오 버튼 UI로 3가지 액션(refine/reroute/new)을 제공:

1. **품질 평가** (규칙 기반, LLM 호출 없음):
   - `success === false` 또는 빈 content → 즉시 suspend
   - `source === "direct"` → 품질 체크 스킵 (인사말 등)
   - 점수 계산: 길이(0.4) + 키워드 커버리지(0.3) + 구조적 품질(0.3)
   - `score < 0.3` → suspend

2. **Suspend**: 워크플로우 일시 중지, 클라이언트에 선택지 포함 응답 반환
   ```json
   {
     "status": "suspended",
     "runId": "...",
     "reason": "결과 품질이 낮습니다",
     "score": 0.25,
     "originalSource": "atlassian",
     "options": [
       { "value": "refine", "label": "추가 지시로 보완" },
       { "value": "reroute", "label": "다른 Agent로 전환" },
       { "value": "new", "label": "새 질문으로 시작" }
     ],
     "availableAgents": [
       { "value": "google-search", "label": "Google Search" },
       { "value": "datahub", "label": "DataHub" }
     ]
   }
   ```

3. **사용자 액션 처리**:

| 액션 | 의미 | 구현 |
|------|------|------|
| **refine** | 같은 Agent + 원본 질문 + 추가 지시 | `resume()` (같은 workflow) |
| **reroute** | 다른 Agent로 전환 | `resume()` (quality-check에서 targetAgent 직접 호출) |
| **new** | 새 질문으로 처음부터 | 새 workflow |

refine과 reroute는 모두 `resume()`으로 quality-check Step에서 처리.
quality-check의 resume 경로에서 `getRegistryEntry(mcpId)`를 통해 Agent를 직접 호출하므로
classify-intent를 다시 거치지 않음.

### API 흐름

```
[새 요청]
POST /chat { inputData: { message: "..." } }
  → workflow.createRun().start()
  → status: "completed" | "suspended"

[Refine: 같은 Agent로 보완]
POST /chat {
  runId: "...",
  resumeData: { action: "refine", userFeedback: "더 자세히 검색해줘" }
}
  → workflow.resume({ step: "quality-check", resumeData })
  → 같은 Agent + 원본 질문 + 피드백 결합 재실행

[Reroute: 다른 Agent로 전환]
POST /chat {
  runId: "...",
  resumeData: { action: "reroute", targetAgent: "google-search", userFeedback: "..." }
}
  → workflow.resume({ step: "quality-check", resumeData })
  → targetAgent + 원본 질문 + 피드백 전달 (classify-intent 우회)

[New: 새 질문]
POST /chat {
  runId: "...",
  resumeData: { action: "new", userFeedback: "새 질문 텍스트" }
}
  → 새 workflow.start({ inputData: { message: "새 질문 텍스트" } })
  → 처음부터 분류 → 라우팅 → 실행
```

### Chat UI 연동

`src/app/chat/page.tsx`에서 suspend 상태 관리:
- `suspendState`가 null → 새 워크플로우 실행
- `suspendState`가 있으면 → 라디오 버튼 패널 표시:
  - **refine**: 텍스트 입력 → resume 요청
  - **reroute**: Agent 선택 칩 + 텍스트 입력 → resume 요청 (targetAgent 포함)
  - **new**: 텍스트 입력 → 새 workflow

## MCP 아키텍처 (Lazy Loading + Registry)

### 연결 방식

| MCP 서버 | 연결 방식 | 위치 | 확장성 |
|----------|----------|------|--------|
| Atlassian (Confluence + Jira) | Streamable HTTP | 외부 Kubernetes 서비스 | HPA 자동 확장 |
| DataHub | Streamable HTTP | 외부 Kubernetes 서비스 | HPA 자동 확장 |
| Google Search | stdio | 로컬 (`google-search-mcp/`) | Agent Server 인스턴스와 함께 |

### Lazy Loading 흐름

```
요청 → agent-step → mcpConnectionManager.getToolsets("atlassian")
                     │
                     ├── 캐시 hit? → toolsets 반환
                     │
                     └── 캐시 miss? → MCP_REGISTRY에서 builder 조회
                                     → MCPClient 생성 + 연결
                                     → 캐시 저장 (5분 TTL)
                                     → listToolsets() → toolsets 반환
```

### 인프라 구조

```
┌──────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                    │
│                                                        │
│  ┌──────────────┐     ┌──────────────────────────┐    │
│  │  Next.js UI   │     │  Mastra Agent Server      │    │
│  │  (port 3000)  │ HTTP│  (port 4111)              │    │
│  │  /mastra/* ───┼────►│  registerApiRoute("/chat") │    │
│  │  rewrite      │     │  registerApiRoute(...)     │    │
│  └──────────────┘     │                          │    │
│                        │  McpConnectionManager     │    │
│                        │  (lazy, 5min TTL cache)   │    │
│                        │  - atlassian ──► HTTP    │    │
│                        │  - datahub   ──► HTTP    │    │
│                        │  - google    ──► stdio   │    │
│                        └──────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Mastra Server 라우트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/chat` | POST | Workflow 실행 (suspend/resume 지원, JSON 응답) |
| `/chat-history` | GET | 대화 기록 조회 (registerApiRoute) |

> 참고: `/api/*` 경로는 Mastra 내부 예약 (agents, workflows 등)

## 초기화 흐름

```
src/mastra/index.ts (top-level await)
  └── initializeMastra()
        ├── createAtlassianAgent()           # Worker Agent 생성 (도구 없이)
        ├── createGoogleSearchAgent()        # Worker Agent 생성 (도구 없이)
        ├── createDataHubAgent()             # Worker Agent 생성 (도구 없이)
        ├── createClassifierAgent()          # Planner Agent 생성
        ├── createFinalResponserAgent()      # 최종 응답 Agent 생성
        └── new Mastra({
              agents: {...},
              workflows: { chatWorkflow },
              storage: PostgresStore,
              server: { apiRoutes: ["/chat", "/chat-history"] }
            })
```

- **Lazy MCP Loading**: MCP 서버는 시작 시 연결하지 않음 → 첫 요청 시 `McpConnectionManager`가 lazy 연결
- Worker Agent는 도구 없이 생성 → 실행 시 `mcpConnectionManager.getToolsets(mcpId)`로 동적 주입
- `McpConnectionManager` 싱글톤이 `MCPClient` 인스턴스를 5분 TTL로 캐시
- Workflow는 `createWorkflow()` → `.then()` / `.branch()` → `.commit()`으로 구성

## 환경변수

```env
# ===== LLM =====
ANTHROPIC_API_KEY=your-anthropic-api-key

# ===== Storage =====
DATABASE_URL=postgresql://user:pass@localhost:5432/mastra

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

### Worker Agent + MCP 추가 (Registry 기반)

Workflow Step/Branch 수정 없이 3개 파일만 변경:

1. **`src/mastra/mcp/mcp-registry.ts`** — Registry에 MCP 서버 등록
   ```typescript
   { id: "new-mcp", name: "New Service", description: "설명...", agentId: "newAgent", builder: () => new MCPClient({...}) }
   ```
2. **`src/mastra/agents/workers/`** — Worker Agent 파일 생성 (팩토리 패턴)
   - `createXxxAgent()` 팩토리 함수 export (도구 없이 생성)
3. **`src/mastra/index.ts`** — `initializeMastra()`에서 Agent 등록
   - 팩토리 함수 호출 + `agents` 객체에 추가

**자동으로 동작하는 것들:**
- `classify-intent`의 `[AVAILABLE AGENTS]`에 자동 포함 (Registry에서 동적 생성)
- `agent-step`이 Registry에서 agentId 조회하여 자동 호출
- `quality-check`의 refine/reroute가 `getRegistryEntry()`로 자동 해결
- 사용자 MCP 활성화 관리 (`user_mcp_activations` 테이블)

### Workflow Step 추가
1. `src/mastra/workflows/steps/`에 Step 파일 생성
   - `createStep({ id, inputSchema, outputSchema, execute })`
2. `chat-workflow.ts`에서 적절한 위치에 `.then()` / `.branch()`로 연결
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
