# CLAUDE.md

## 프로젝트 개요

Mastra 기반 Multi-Agent AI 애플리케이션 (MMIAI)

LangGraph 단일 Agent → Mastra Agent Network → **Mastra Workflow** 구조로 진화한 프로젝트.
Workflow가 사용자 요청을 구조화된 Step으로 처리하는 **Deterministic Workflow + Planner 패턴**.

**Mastra Agent Server**와 **Next.js UI**가 분리 배포/스케일링 가능한 구조.
MCP Registry 기반 동적 확장 — Worker Agent/MCP 추가 시 Workflow Step/Branch 수정 불필요.
A2A (Agent-to-Agent) 프로토콜로 외부 Agent Server와 JSON-RPC 2.0 통신.

## 기술 스택

- **Runtime**: Node.js >= 22.13.0
- **Framework**: Next.js 16 (App Router) - UI Only
- **Agent Server**: Mastra Server (port 4111)
- **Agent Framework**: Mastra (Workflow 패턴)
- **MCP**: @mastra/mcp (Model Context Protocol 통합)
- **A2A**: @a2a-js/sdk (Agent-to-Agent 프로토콜, JSON-RPC 2.0)
- **Evals**: @mastra/evals (createScorer — LLM-based 품질 평가)
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
  │  registerApiRoute("/chat")       ← AI SDK SSE streaming + suspend/resume
  │  registerApiRoute("/mcp/*")
  │  /api/a2a/:agentId               ← A2A JSON-RPC 2.0 (Mastra 자동 등록)
  │  /.well-known/:agentId/agent-card.json  ← A2A Agent Card (자동)
  │
  ├── Chat Workflow (dountil Loop + Classifier HITL)
  │     ├── dountil(classifyAndExecuteWorkflow, condition)
  │     │     ├── classify-intent (Planner + HITL suspend)
  │     │     │     ├── clarify → suspend (일반 텍스트 질문)
  │     │     │     └── ambiguous → suspend (Plan 선택 카드)
  │     │     ├── .branch(simple | agent) → 2분기
  │     │     ├── .map() → 출력 정규화
  │     │     └── quality-check (2단계 품질 게이트)
  │     │           └── 코드 필터 + qualityScorer(LLM) → PASS/FAIL(retry)
  │     └── synthesize-response (루프 후)
  │
  ├── Worker Agents (Workflow용, 도구 lazy 주입)
  │     ├── AtlassianAgent → MCP (HTTP)
  │     ├── GoogleSearchAgent → MCP (stdio)
  │     ├── DataHubAgent → MCP (HTTP)
  │     └── DataAnalystAgent → MCP (HTTP)
  │
  ├── A2A Agents (자기 완결적, MCP tools baked-in)
  │     ├── a2aAtlassian → MCP (HTTP)
  │     ├── a2aGoogleSearch → MCP (stdio)
  │     ├── a2aDataHub → MCP (HTTP)
  │     └── a2aSupervisor → list/call-a2a-agent 도구
  │
  ├── A2A Server Registry (PostgreSQL)
  │     └── 외부 A2A 서버 등록 + Agent 디스커버리
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
│   │   ├── (chat)/             # Chat 레이아웃 그룹
│   │   │   ├── page.tsx        # 홈 (새 채팅)
│   │   │   ├── chat/[id]/page.tsx  # Chat UI 페이지
│   │   │   ├── a2a/            # A2A Agent UI
│   │   │   │   ├── page.tsx    # A2A Agent 목록
│   │   │   │   ├── [agentId]/page.tsx  # A2A Agent 채팅
│   │   │   │   └── settings/page.tsx   # A2A 서버 관리
│   │   │   └── layout.tsx      # Sidebar 레이아웃
│   │   ├── api/                # Next.js API Routes
│   │   │   ├── chats/          # Chat CRUD (DB)
│   │   │   └── a2a/            # A2A 서버/Agent 관리 API
│   │   │       ├── agents/route.ts        # GET: Agent 카탈로그
│   │   │       └── servers/               # CRUD: 외부 서버 관리
│   │   └── layout.tsx          # Root 레이아웃
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 기본 컴포넌트
│   │   ├── a2a/                # A2A 관련 UI 컴포넌트
│   │   │   ├── a2a-chat.tsx    # A2A Agent 채팅 UI
│   │   │   ├── a2a-message.tsx # A2A 메시지 렌더링
│   │   │   ├── a2a-testbed.tsx # A2A Testbed
│   │   │   ├── agent-list.tsx  # Agent 목록 사이드바
│   │   │   └── server-management.tsx  # 서버 관리 UI
│   │   ├── chat.tsx            # Chat 메인 컴포넌트 (useChat + HITL)
│   │   ├── chat-tools.tsx      # HITL Tool UI (PlanSelectToolUI)
│   │   ├── message.tsx         # 메시지 렌더링
│   │   ├── messages.tsx        # 메시지 목록
│   │   ├── multimodal-input.tsx # 입력 UI
│   │   ├── app-sidebar.tsx     # 사이드바 (Chat/A2A 탭)
│   │   └── sidebar-history.tsx # 채팅 이력
│   ├── hooks/                  # React hooks
│   ├── lib/
│   │   ├── db/                 # Database (drizzle)
│   │   │   ├── schema.ts       # 테이블 스키마
│   │   │   ├── queries.ts      # CRUD 쿼리
│   │   │   └── index.ts        # DB 연결
│   │   └── utils.ts            # 유틸리티 함수
│   └── mastra/                 # Mastra Agent 설정 (Server 전용)
│       ├── index.ts            # top-level await, mastra export, /chat 핸들러
│       ├── mcp/
│       │   ├── index.ts               # MCP 오케스트레이션 (exports)
│       │   ├── mcp-registry.ts        # Admin MCP Registry (서버 정의 + builder)
│       │   ├── connection-manager.ts   # Lazy MCPClient 캐시 (5분 TTL)
│       │   ├── user-activation.ts     # Per-user MCP 활성화 상태 (PostgreSQL)
│       │   └── datahub-fallback-tools.ts  # DataHub 재귀 스키마 fallback
│       ├── a2a/                # A2A (Agent-to-Agent) 인프라
│       │   ├── a2a-client.ts          # 공유 A2A 유틸리티 (@a2a-js/sdk 타입 기반)
│       │   ├── a2a-registry.ts        # 외부 A2A 서버 등록 + Agent 디스커버리 (PostgreSQL)
│       │   ├── utils.ts               # getMcpTools(), flattenToolsets()
│       │   ├── agents/                # A2A 전용 Agent 정의
│       │   │   ├── index.ts
│       │   │   ├── a2a-atlassian.ts   # Confluence/Jira (Haiku)
│       │   │   ├── a2a-google-search.ts # 웹 검색 (Haiku)
│       │   │   ├── a2a-datahub.ts     # 데이터 카탈로그 (Haiku)
│       │   │   └── a2a-supervisor.ts  # 멀티 Agent 오케스트레이터 (Sonnet)
│       │   └── tools/                 # A2A 도구
│       │       ├── call-a2a-agent.ts  # JSON-RPC 2.0 A2A 호출
│       │       └── list-a2a-agents.ts # 사용 가능한 Agent 목록 조회
│       ├── scorers/            # Mastra Scorer (LLM Judge 기반)
│       │   ├── index.ts               # export { qualityScorer }
│       │   └── quality-scorer.ts      # Agent 응답 품질 평가 (Haiku Judge)
│       ├── tools/              # 공유 도구
│       │   ├── current-time.ts        # 현재 시간 조회 (Classifier용)
│       │   └── shaper-tool.ts         # 데이터 변환 도구
│       ├── workflows/          # Workflow 정의
│       │   ├── chat-workflow.ts       # 메인 Chat Workflow (dountil + synthesize)
│       │   ├── state.ts               # 공유 상태 스키마
│       │   └── steps/                 # Workflow Steps
│       │       ├── classify-intent.ts # Planner + HITL Step
│       │       ├── agent-steps.ts     # 통합 Agent Step
│       │       ├── quality-check.ts   # 2단계 품질 게이트
│       │       └── synthesize-response.ts  # 최종 응답 합성 Step
│       └── agents/
│           ├── classifier-agent.ts    # 의도 분류 + 실행 계획 Agent (Sonnet)
│           ├── final-responser/       # 최종 응답 합성 Agent
│           └── workers/               # Worker Agents
│               ├── index.ts
│               ├── atlassian-agent.ts
│               ├── google-search-agent.ts
│               ├── datahub-agent.ts
│               └── data-analyst-agent.ts
├── docs/
│   ├── workflow-hitl-architecture.drawio  # 아키텍처 다이어그램
│   └── workflow-migration-analysis.md     # Workflow 전환 분석 문서
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
╔══════════════════════════════════════════════════╗
║  dountil Loop (classifyAndExecuteWorkflow)       ║
║  max 3 iterations                                ║
║                                                  ║
║  ┌────────────────────────────┐                  ║
║  │ classify-intent (Planner)  │                  ║
║  │ Classifier Agent           │                  ║
║  │ 의도 분류 + 실행 계획      │                  ║
║  └──┬───────┬───────┬─────┬──┘                   ║
║     │       │       │     │                      ║
║  clarify ambiguous simple agent                  ║
║     │       │       │     │                      ║
║  suspend suspend    │  ┌──┴──────────┐           ║
║     │       │       │  │ agent-step  │           ║
║  (사용자   (사용자   │  │ (통합)      │           ║
║   답변)    선택)    │  │ single/     │           ║
║     │       │       │  │ parallel/   │           ║
║  resume  resume     │  │ sequential  │           ║
║     │       │       │  └──┬──────────┘           ║
║     └───────┘       └─────┘                      ║
║                       │                          ║
║                  .map() (출력 정규화)              ║
║                       │                          ║
║              ┌────────┴────────┐                  ║
║              │  quality-check  │ ← LLM Judge       ║
║              │  (순수 게이트)   │                  ║
║              └───┬─────────┬───┘                  ║
║                  │         │                      ║
║               PASS      FAIL                     ║
║             (exit)    source="retry"             ║
║                  │         │                      ║
║                  │    state.previousFeedback      ║
║                  │         └──→ classify-intent   ║
║                  │              (다음 iteration)   ║
╚══════════════════╪════════════════════════════════╝
                   │
                   ▼
          ┌─────────────────┐
          │ synthesize-     │  ← Final Responser Agent (Haiku)
          │ response        │
          └────────┬────────┘
                   │
                   ▼
             User Response
```

### Workflow 구조 (코드)

```typescript
// 내부 루프: classify → branch → quality-check
const classifyAndExecuteWorkflow = createWorkflow(...)
  .then(classifyIntentStep)         // Planner + HITL
  .branch([simple, agent])          // 2분기
  .map(normalize)                   // 출력 정규화
  .then(qualityCheckStep)           // 순수 품질 게이트
  .commit();

// 메인 Workflow: dountil 루프 + 합성
export const chatWorkflow = createWorkflow(...)
  .dountil(classifyAndExecuteWorkflow, exitCondition)  // max 3
  .then(synthesizeResponseStep)                         // 최종 합성
  .commit();
```

### 설계 원칙

| 원칙 | 구현 방식 |
|------|----------|
| 라우팅 | Planner (의도 분류 + 실행 계획) + `.branch()` 2분기 |
| 데이터 흐름 | Zod 스키마 검증 (Step 간 타입 안전) |
| 병렬/순차 | `executionMode`로 선언적 제어 (parallel/sequential) |
| Sequential 맥락 | `goal` + `contextHint`로 단계 간 구조화된 컨텍스트 전달 |
| HITL | `suspend()` / `resume()` (classify-intent Step — 단일 suspend 포인트) |
| 자동 재시도 | `dountil` 루프 + `state.previousFeedback` (UI 개입 없음) |
| 품질 평가 | Mastra Scorer (LLM Judge — Haiku) |
| 동적 확장 | MCP Registry 기반 — Agent/MCP 추가 시 Step/Branch 수정 불필요 |
| 에러 처리 | Step 단위 try/catch + 재시도 |
| 관측성 | Step별 input/output 자동 추적 |

### Workflow Steps

| Step | 역할 | 모델 | 설명 |
|------|------|------|------|
| `classify-intent` | Planner + HITL | Sonnet | 의도 분류 + 실행 계획. clarify/ambiguous 시 suspend |
| `direct-response` | 직접 응답 | - | 인사말 등 단순 질문, 분류 reasoning을 content로 전달 |
| `agent-step` | 통합 Agent 실행 | Haiku | Registry 기반 동적 Agent 호출. 1개=single, 2개+=parallel/sequential |
| `quality-check` | 2단계 품질 게이트 | Haiku (Judge) | 코드 필터 + LLM Judge, 실패 시 source="retry" 반환 |
| `synthesize-response` | 최종 응답 | Haiku | 검색 결과 + clarifyAnswer 기반 사용자 응답 생성 |

### 라우팅 규칙 (Confidence Score 기반)

| 분류 type | Confidence | 대상 | 설명 |
|-----------|-----------|------|------|
| `simple` | - | 직접 응답 | 인사말, 단순 질문 (외부 데이터 불필요) |
| `agent` | > 90% | Agent Step | 실행 계획이 명확. targets 배열로 동적 결정 |
| `ambiguous` | 60~90% | HITL suspend | 정보 충분하나 복수 실행 계획 경합 → Plan 선택 카드 (candidates) |
| `clarify` | < 60% | HITL suspend | 필수 정보 부족 → 사용자에게 질문 (clarifyQuestion) |

**핵심 구분**: clarify = 정보 자체가 MISSING (slot filling), ambiguous = 정보는 충분하나 해석이 CONFLICTING (plan 선택)

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

## Mastra Scorer

Mastra `createScorer()` API + PromptObject를 사용한 LLM Judge.
`src/mastra/scorers/` 디렉토리에 위치.

### qualityScorer (LLM Judge — Haiku)

quality-check Step에서 Agent 응답 품질 평가.
Pipeline: `analyze (LLM)` → `generateScore (code)` → `generateReason (code)`

| 평가 차원 | 가중치 | 설명 |
|-----------|--------|------|
| Relevance | 0.35 | 응답이 사용자 질문에 실제로 답하는가 (의미적 매칭) |
| Completeness | 0.30 | 질문의 모든 측면을 다루는가 |
| Usefulness | 0.20 | 실질적 정보 제공 vs "결과 없음" 응답 |
| Coherence | 0.15 | 구조, 가독성, 논리적 조직화 |

`QUALITY_THRESHOLD = 0.4` — 이하 시 source="retry" 반환 → dountil 루프백.

quality-check는 `state.clarifyAnswer`가 있으면 `fullUserIntent`(원본 질문 + clarify 답변)로 Scorer에 전달하여 정확한 평가.

LLM Judge 핵심 규칙:
- "검색 결과 없음" 유형 → usefulness 반드시 0.0
- 질문과 무관한 주제 → relevance 반드시 0.0
- `improvementSuggestion` 필드로 Classifier에 구체적 개선 방향 전달

### Worker Agent Confidence (structuredOutput)

Worker Agent는 `structuredOutput`으로 `{ content, confidence }` 반환.
`confidence` (0.0-1.0)는 Agent 자기 확신도 — retryHistory에 기록되어 Classifier가 참조.

### quality-check 2단계 구조

```
1단계 (코드): success === false || empty → 즉시 FAIL (LLM 호출 없음)
2단계 (LLM): qualityScorer(Haiku) → 의미 기반 평가 → PASS/FAIL
```

### 프롬프트 구조 (classify-intent)

```
{userMessage}

[AVAILABLE AGENTS]
- "atlassian": Confluence documents, Jira issues...
- "datahub": Data catalog exploration...

[CLARIFY ANSWER]                    ← state.clarifyAnswer가 있을 때
사용자가 이전 clarify 질문에 대해 제공한 추가 정보입니다:
"타이페이"

[RETRY HISTORY]                     ← retryHistory > 0일 때
이전 N회 시도의 품질이 부족했습니다:
- Attempt 1: targets=[atlassian] queries={...} reason="..." confidence=0.45

IMPORTANT: You may ONLY route to agents listed above...
```

## Human-in-the-Loop (HITL)

### 구조

**Classifier 중심 단일 Suspend 포인트** — `classify-intent` Step만 suspend 가능.

3가지 HITL 경로:

| HITL Type | 트리거 | UI | 처리 |
|-----------|--------|-----|------|
| **clarify** | 정보 부족 (confidence < 60%) | 일반 텍스트 메시지 (어시스턴트) | 사용자 답변 → `resume({ userAnswer })` → `state.clarifyAnswer`에 저장 → 재분류 |
| **ambiguous** | 복수 실행 계획 경합 (confidence 60~90%) | Plan 선택 카드 (tool-approval) | 사용자 선택 → `resume({ selectedPlan, selectedTargets, selectedExecutionMode })` → 선택 Plan으로 실행 |
| **자동 재시도** | quality-check 실패 | UI 없음 (자동) | `state.previousFeedback` → dountil 루프백 → Classifier가 전략 개선 |

### Clarify 데이터 흐름 (구조화된 Workflow State)

clarify 답변은 `state.clarifyAnswer`에 별도 필드로 저장. `originalMessage`는 원본 보존.

```
suspend → 일반 text-delta로 clarifyQuestion 출력
        + data-suspend-meta (transient) → { runId, suspendedStep, hitlType }
→ 사용자 텍스트 입력
→ /chat 핸들러: body.suspendMeta 감지 → clarify resume
→ resumeStream({ userAnswer })
→ classify-intent: setState({ clarifyAnswer }) + [CLARIFY ANSWER] 시스템 섹션 주입 → 재분류
→ quality-check: fullUserIntent = originalMessage + clarifyAnswer → Scorer 평가
→ synthesize-response: clarifyAnswer를 별도 프롬프트 섹션으로 참조
```

### Ambiguous 데이터 흐름 (Tool Approval)

```
suspend → tool-input-available(selectExecutionPlan) + tool-approval-request
→ PlanSelectToolUI에서 Plan 선택
→ addToolApprovalResponse → sendAutomaticallyWhen
→ detectToolApprovalResume → extractResumeData
→ resumeStream({ selectedPlan, selectedTargets, selectedExecutionMode })
→ classify-intent: 선택 Plan으로 즉시 실행 (재분류 우회)
```

### Suspend Payload

```json
{
  "status": "suspended",
  "runId": "...",
  "suspendedStep": ["classify-and-execute", "classify-intent"],
  "hitlType": "clarify" | "ambiguous",
  "clarifyQuestion": "어떤 프로젝트의 데이터를 찾으시나요?",
  "candidates": [
    {
      "planId": "confluence-search",
      "label": "Confluence 문서 검색",
      "description": "사내 문서에서 관련 정보를 검색합니다",
      "targets": ["atlassian"],
      "executionMode": "parallel",
      "expectedOutcome": "관련 문서 목록 및 내용 요약"
    }
  ],
  "originalMessage": "..."
}
```

> **Note**: `result.suspendPayload`는 nested workflow(dountil) 구조에서 `{ "classify-and-execute": { ...actualPayload } }`로 래핑됩니다. `/chat` 핸들러에서 `rawPayload?.["classify-and-execute"] || rawPayload`로 언래핑 필요.

### Chat UI 연동 (`src/components/chat.tsx`)

AI SDK `useChat` + `DefaultChatTransport` 기반:
- `suspendMetaRef` — clarify suspend 메타데이터 관리 (useRef로 최신값 보장)
- `onData` 콜백에서 `data-suspend-meta` transient part 수신 → suspendMetaRef 설정
- `prepareSendMessagesRequest`에서 `body.suspendMeta` 포함 → 다음 메시지가 resume
- `sendAutomaticallyWhen` → ambiguous tool-approval 자동 감지 + resume

## Workflow 공유 상태

`src/mastra/workflows/state.ts`에 정의된 `workflowStateSchema`:

| 필드 | 타입 | 설명 |
|------|------|------|
| `originalMessage` | `string?` | 원본 사용자 메시지 (dountil 루프 across iteration 유지) |
| `clarifyAnswer` | `string?` | clarify resume 시 사용자가 제공한 추가 정보 (구조화 보존) |
| `executionTargets` | `string[]` | 실행된 Agent 목록 (MCP ID) |
| `executionMode` | `"parallel" \| "sequential"` | 실행 모드 |
| `executionQueries` | `{ agentId, query }[]` | 이번 시도의 Agent별 쿼리 |
| `previousFeedback` | `string?` | quality-check 실패 시 최신 피드백 |
| `retryCount` | `number` | 현재 재시도 횟수 (0-based) |
| `retryHistory` | `RetryEntry[]` | 재시도 전체 이력 (누적) |

`RetryEntry`: `{ attempt, targets, executionMode, queries, reason, confidence? }`

quality-check 실패 시 `retryHistory`에 이력 누적 + `previousFeedback` 업데이트.
다음 iteration에서 classify-intent가 `retryHistory`를 `[RETRY HISTORY]` 섹션으로 프롬프트에 주입하여 이미 실패한 전략의 반복을 방지.

## A2A (Agent-to-Agent) 아키텍처

### 개요

Mastra는 모든 등록된 Agent를 **자동으로 A2A 엔드포인트로 노출**:
- `GET /.well-known/:agentId/agent-card.json` — Agent Card (디스커버리)
- `POST /a2a/:agentId` — JSON-RPC 2.0 실행

### Agent 구분: Workflow용 vs A2A용

| 구분 | Workflow Agent | A2A Agent |
|------|---------------|-----------|
| 위치 | `agents/workers/` | `a2a/agents/` |
| 도구 | 요청 시점 lazy 주입 | 생성 시 baked-in |
| 용도 | classify-intent → agent-step | 외부/Supervisor 호출 |
| ID 패턴 | `atlassianAgent` | `a2aAtlassian` |
| 모델 | 설정별 상이 | Haiku (Supervisor만 Sonnet) |

### A2A Agents

| Agent | ID | 모델 | 설명 |
|-------|-----|------|------|
| `a2aAtlassian` | a2aAtlassian | Haiku | Confluence/Jira, MCP tools baked-in |
| `a2aGoogleSearch` | a2aGoogleSearch | Haiku | 웹 검색, MCP tools baked-in |
| `a2aDataHub` | a2aDataHub | Haiku | 데이터 카탈로그, MCP tools baked-in |
| `a2aSupervisor` | a2aSupervisor | Sonnet | list/call-a2a-agent 도구로 멀티 Agent 오케스트레이션 |

### A2A Server Registry (PostgreSQL)

외부 A2A 서버를 등록하고 Agent를 자동 디스커버리:

```sql
a2a_servers (id, name, base_url, active, created_at, updated_at)
a2a_discovered_agents (server_id, agent_id, name, description, skills, discovered_at)
```

**디스커버리 흐름**: 서버 등록 → `GET {baseUrl}/api/agents` → 각 Agent의 `/.well-known/{agentId}/agent-card.json` 조회 → DB 저장

### A2A API Routes (Next.js)

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/a2a/agents` | GET | 로컬 + 외부 Agent 카탈로그 |
| `/api/a2a/servers` | GET/POST/DELETE/PATCH | 외부 서버 CRUD + 활성화 토글 |
| `/api/a2a/servers/[serverId]/discover` | POST | 수동 Agent 재디스커버리 |

### A2A 도구

| 도구 | 사용처 | 설명 |
|------|--------|------|
| `call-a2a-agent` | Supervisor | JSON-RPC 2.0으로 A2A Agent 호출 (context 전달 지원) |
| `list-a2a-agents` | Supervisor | 로컬 + 외부 Agent 목록 조회 |

### Supervisor 오케스트레이션 패턴

```
Supervisor Agent
  ├── list-a2a-agents → [atlassian, datahub, google-search, ...]
  ├── call-a2a-agent(atlassian, "문서 검색")
  │     └── context: 이전 Agent 결과 전달 (sequential)
  └── call-a2a-agent(datahub, "테이블 조회", context: 이전 결과)
```

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
│  │  /mastra/* ───┼────►│  /chat (Workflow SSE)      │    │
│  │  rewrite      │     │  /a2a/:agentId (A2A)       │    │
│  └──────────────┘     │                          │    │
│                        │  McpConnectionManager     │    │
│                        │  (lazy, 5min TTL cache)   │    │
│                        │  - atlassian ──► HTTP    │    │
│                        │  - datahub   ──► HTTP    │    │
│                        │  - google    ──► stdio   │    │
│                        └──────────────────────────┘    │
│                                                        │
│  ┌──────────────────────────────────────┐              │
│  │  외부 A2A Server (선택적)              │              │
│  │  Mastra 또는 다른 A2A 구현            │              │
│  │  /.well-known/:agentId/agent-card    │              │
│  │  /a2a/:agentId                       │              │
│  └──────────────────────────────────────┘              │
└──────────────────────────────────────────────────────┘
```

## Mastra Server 라우트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/chat` | POST | Workflow 실행 (AI SDK SSE streaming, suspend/resume) |
| `/mcp/registry` | GET | 전체 MCP 목록 |
| `/mcp/activations` | GET/POST | 사용자별 MCP 활성화 상태 조회/토글 |
| `/a2a/:agentId` | POST | A2A JSON-RPC 2.0 (Mastra 자동 등록) |
| `/.well-known/:agentId/agent-card.json` | GET | A2A Agent Card (Mastra 자동 등록) |

> 참고: `/api/*` 경로는 Mastra 내부 예약 (agents, workflows 등)

## 초기화 흐름

```
src/mastra/index.ts (top-level await)
  └── initializeMastra()
        ├── Worker Agents (도구 없이 생성)
        │     createAtlassianAgent(), createGoogleSearchAgent(),
        │     createDataHubAgent(), createDataAnalystAgent()
        ├── 공유 Memory 생성 (conversationMemory)
        ├── createClassifierAgent(memory)     # Planner Agent
        ├── createFinalResponserAgent(memory)  # 응답 합성 Agent
        ├── A2A Agents (direct import, 자기 완결적)
        │     a2aAtlassian, a2aGoogleSearch,
        │     a2aDataHub, a2aSupervisor
        └── new Mastra({
              agents: { workflow용 + A2A용 },
              workflows: { chatWorkflow },
              storage: PostgresStore,
              server: { apiRoutes: ["/chat", "/mcp/*"] }
            })
```

- **Lazy MCP Loading**: MCP 서버는 시작 시 연결하지 않음 → 첫 요청 시 `McpConnectionManager`가 lazy 연결
- Worker Agent는 도구 없이 생성 → 실행 시 `mcpConnectionManager.getToolsets(mcpId)`로 동적 주입
- A2A Agent는 생성 시 `getMcpTools(mcpId)`로 도구 baked-in (자기 완결적)
- `McpConnectionManager` 싱글톤이 `MCPClient` 인스턴스를 5분 TTL로 캐시
- Workflow는 `createWorkflow()` → `.dountil()` / `.then()` / `.branch()` → `.commit()`으로 구성

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
   { id: "new-mcp", name: "New Service", description: "설명... Keywords: 키워드1, 키워드2", agentId: "newAgent", builder: () => new MCPClient({...}) }
   ```
2. **`src/mastra/agents/workers/`** — Worker Agent 파일 생성 (팩토리 패턴)
   - `createXxxAgent()` 팩토리 함수 export (도구 없이 생성)
3. **`src/mastra/index.ts`** — `initializeMastra()`에서 Agent 등록
   - 팩토리 함수 호출 + `agents` 객체에 추가

**자동으로 동작하는 것들:**
- `classify-intent`의 `[AVAILABLE AGENTS]`에 자동 포함 (Registry에서 동적 생성)
- `agent-step`이 Registry에서 agentId 조회하여 자동 호출
- 사용자 MCP 활성화 관리 (`user_mcp_activations` 테이블)

### A2A Agent 추가

1. **`src/mastra/a2a/agents/`** — A2A Agent 파일 생성
   - `getMcpTools(mcpId)`로 도구 baked-in
   - `new Agent({ id, model, tools, instructions })` 직접 export
2. **`src/mastra/a2a/agents/index.ts`** — export 추가
3. **`src/mastra/index.ts`** — `agents` 객체에 추가
   → Mastra가 자동으로 A2A 엔드포인트 노출

### 외부 A2A 서버 연동

UI 또는 API로 등록:
```
POST /api/a2a/servers
{ "id": "external-service", "name": "External Agent", "baseUrl": "http://external:4111" }
```
→ 자동 Agent 디스커버리 → Supervisor가 `call-a2a-agent`로 호출 가능

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
