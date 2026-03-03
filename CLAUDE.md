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
  │  registerApiRoute("/chat")       ← suspend/resume 지원
  │  registerApiRoute("/chat-history")
  │
  ├── Chat Workflow (dountil Loop + Classifier HITL)
  │     ├── dountil(classifyAndExecuteWorkflow, condition)
  │     │     ├── classify-intent (Planner + HITL suspend)
  │     │     │     ├── clarify → suspend (사용자 질문)
  │     │     │     └── ambiguous → suspend (Agent 선택)
  │     │     ├── .branch(simple | agent) → 2분기
  │     │     ├── .map() → 출력 정규화
  │     │     └── quality-check (2단계 품질 게이트)
  │     │           └── 코드 필터 + qualityScorer(LLM) → PASS/FAIL(retry)
  │     └── synthesize-response (루프 후)
  │
  ├── Worker Agents
  │     ├── AtlassianAgent → MCP (HTTP)
  │     ├── GoogleSearchAgent → MCP (stdio)
  │     ├── DataHubAgent → MCP (HTTP)
  │     └── DataAnalystAgent → MCP (HTTP)
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
│   │   ├── chat/page.tsx       # Chat UI 페이지 (clarify/ambiguous HITL)
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
│       ├── scorers/            # Mastra Scorer (LLM Judge 기반)
│       │   ├── index.ts               # export { qualityScorer }
│       │   └── quality-scorer.ts      # Agent 응답 품질 평가 (Haiku Judge, quality-check용)
│       ├── workflows/          # Workflow 정의
│       │   ├── chat-workflow.ts       # 메인 Chat Workflow (dountil + synthesize)
│       │   ├── state.ts               # 공유 상태 스키마 (previousFeedback 포함)
│       │   └── steps/                 # Workflow Steps
│       │       ├── classify-intent.ts # Planner + HITL Step (clarify/ambiguous suspend)
│       │       ├── agent-steps.ts     # 통합 Agent Step (single/multi 동적)
│       │       ├── quality-check.ts   # 2단계 품질 게이트 (코드 필터 + LLM Judge)
│       │       └── synthesize-response.ts  # 최종 응답 합성 Step
│       └── agents/
│           ├── classifier-agent.ts    # 의도 분류 + 실행 계획 Agent (Haiku)
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
| `agent-step` | 통합 Agent 실행 | Haiku | Registry 기반 동적 Agent 호출. 1개=single, 2개+=parallel/sequential. Self-Diagnosis 파싱 포함 |
| `quality-check` | 2단계 품질 게이트 | Haiku (Judge) | 코드 필터 + LLM Judge, 실패 시 source="retry" 반환 (suspend 없음) |
| `synthesize-response` | 최종 응답 | Haiku | 검색 결과 기반 사용자 응답 생성 |

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

[RETRY HISTORY]                     ← retryHistory > 0일 때
이전 N회 시도의 품질이 부족했습니다:
- Attempt 1: targets=[atlassian] queries={...} reason="..." confidence=0.45

최신 피드백:
Score 0.28: relevance=0.30, completeness=0.20, usefulness=0.10, coherence=0.70
부족한 영역: 유용성: 검색 결과가 비어있음
개선 방향: 더 구체적인 검색 키워드 사용 필요

IMPORTANT: You may ONLY route to agents listed above...
```

## Human-in-the-Loop (HITL)

### 구조

**Classifier 중심 단일 Suspend 포인트** — `classify-intent` Step만 suspend 가능.

3가지 HITL 경로:

| HITL Type | 트리거 | UI | 처리 |
|-----------|--------|-----|------|
| **clarify** | 정보 부족 (confidence < 60%) | 어시스턴트 질문 메시지 | 사용자 답변 → `resume({ userAnswer })` → 재분류 |
| **ambiguous** | 복수 실행 계획 경합 (confidence 60~90%) | Plan 선택 카드 | 사용자 선택 → `resume({ selectedPlan, selectedTargets, selectedExecutionMode })` → 선택 Plan으로 실행 |
| **자동 재시도** | quality-check 실패 또는 sourceFound=false | UI 없음 (자동) | `state.previousFeedback` → dountil 루프백 → Classifier가 전략 개선 |

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
    },
    {
      "planId": "datahub-lookup",
      "label": "DataHub 데이터 조회",
      "description": "데이터 카탈로그에서 테이블/스키마를 검색합니다",
      "targets": ["datahub"],
      "executionMode": "parallel",
      "expectedOutcome": "테이블 스키마 및 메타데이터"
    }
  ],
  "originalMessage": "..."
}
```

> **Note**: `result.suspendPayload`는 nested workflow(dountil) 구조에서 `{ "classify-and-execute": { ...actualPayload } }`로 래핑됩니다. `/chat` 핸들러에서 `rawPayload?.["classify-and-execute"] || rawPayload`로 언래핑 필요.

### API 흐름

```
[새 요청]
POST /chat { userId, inputData: { message: "..." } }
  → workflow.createRun().start()
  → status: "completed" | "suspended"

[Clarify: 사용자 답변]
POST /chat {
  userId, runId, suspendedStep: [...],
  resumeData: { userAnswer: "영상처리 관련 데이터입니다" }
}
  → workflow.resume({ step: suspendedStep, resumeData })
  → 원본 + 답변 결합 재분류 → 실행

[Ambiguous: Plan 선택]
POST /chat {
  userId, runId, suspendedStep: [...],
  resumeData: {
    selectedPlan: "datahub-lookup",
    selectedTargets: ["datahub"],
    selectedExecutionMode: "parallel"
  }
}
  → workflow.resume({ step: suspendedStep, resumeData })
  → 선택 Plan으로 즉시 실행 (재분류 우회)

[New: 새 질문 (ambiguous에서 텍스트 입력)]
POST /chat {
  userId, runId,
  resumeData: { action: "new", userFeedback: "새 질문 텍스트" }
}
  → 새 workflow.start({ inputData: { message: "새 질문 텍스트" } })
```

### Chat UI 연동

`src/app/chat/page.tsx`에서 suspend 상태 관리:
- `suspendState === null` → 일반 모드 (새 워크플로우 실행)
- `hitlType === "clarify"` → 어시스턴트 질문 메시지 표시 + 사용자 텍스트 답변
- `hitlType === "ambiguous"` → Plan 선택 카드 표시 (planId, label, description, expectedOutcome) + 텍스트 입력 시 새 질문

## Workflow 공유 상태

`src/mastra/workflows/state.ts`에 정의된 `workflowStateSchema`:

| 필드 | 타입 | 설명 |
|------|------|------|
| `executionTargets` | `string[]` | 실행된 Agent 목록 (MCP ID) |
| `executionMode` | `"parallel" \| "sequential"` | 실행 모드 |
| `previousFeedback` | `string?` | quality-check 실패 시 최신 피드백 |
| `retryCount` | `number` | 현재 재시도 횟수 (0-based) |
| `retryHistory` | `RetryEntry[]` | 재시도 전체 이력 (누적) |

`RetryEntry`: `{ attempt, targets, executionMode, reason, sourceFound?, confidence? }`

quality-check 실패 시 `retryHistory`에 이력 누적 + `previousFeedback` 업데이트.
다음 iteration에서 classify-intent가 `retryHistory`를 `[RETRY HISTORY]` 섹션으로 프롬프트에 주입하여 이미 실패한 전략의 반복을 방지.

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
| `/mcp/registry` | GET | 전체 MCP 목록 |
| `/mcp/activations` | GET/POST | 사용자별 MCP 활성화 상태 조회/토글 |

> 참고: `/api/*` 경로는 Mastra 내부 예약 (agents, workflows 등)

## 초기화 흐름

```
src/mastra/index.ts (top-level await)
  └── initializeMastra()
        ├── createAtlassianAgent()           # Worker Agent 생성 (도구 없이)
        ├── createGoogleSearchAgent()        # Worker Agent 생성 (도구 없이)
        ├── createDataHubAgent()             # Worker Agent 생성 (도구 없이)
        ├── createDataAnalystAgent()         # Worker Agent 생성 (도구 없이)
        ├── createClassifierAgent()          # Planner Agent 생성
        ├── createFinalResponserAgent()      # 최종 응답 Agent 생성
        └── new Mastra({
              agents: {...},
              workflows: { chatWorkflow },
              storage: PostgresStore,
              server: { apiRoutes: ["/chat", "/chat-history", "/mcp/*"] }
            })
```

- **Lazy MCP Loading**: MCP 서버는 시작 시 연결하지 않음 → 첫 요청 시 `McpConnectionManager`가 lazy 연결
- Worker Agent는 도구 없이 생성 → 실행 시 `mcpConnectionManager.getToolsets(mcpId)`로 동적 주입
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
