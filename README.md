# MMIAI — Mastra Multi-Agent AI

Mastra 기반 Multi-Agent AI 애플리케이션. Workflow가 사용자 요청을 구조화된 Step으로 처리하는 **Deterministic Workflow + Planner** 패턴.

**Mastra Agent Server**와 **Next.js UI**가 분리 배포/스케일링 가능한 구조입니다.

## 아키텍처 개요

```
Browser → Next.js UI (port 3000) → /mastra/* rewrite → Mastra Agent Server (port 4111)
```

| 컴포넌트 | 역할 | 포트 |
|----------|------|------|
| **Next.js (web)** | Chat UI, API Routes, A2A 관리 | 3000 |
| **Mastra Server** | Workflow 실행, Agent 호출, MCP 통신, A2A 엔드포인트 | 4111 |
| **PostgreSQL** | Storage, Memory, MCP 활성화 상태, A2A Registry | 5432 |

## 빠른 시작 (Docker Compose)

### 1. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 아래 값을 채우세요:

| 변수 | 필수 | 설명 |
|------|------|------|
| `ANTHROPIC_API_KEY` | **필수** | Anthropic API 키 |
| `CONFLUENCE_URL` | 선택 | Atlassian Confluence URL |
| `CONFLUENCE_USERNAME` | 선택 | Confluence 사용자 이메일 |
| `CONFLUENCE_API_TOKEN` | 선택 | Confluence API 토큰 |
| `JIRA_URL` | 선택 | Jira URL |
| `JIRA_USERNAME` | 선택 | Jira 사용자 이메일 |
| `JIRA_API_TOKEN` | 선택 | Jira API 토큰 |
| `DATAHUB_GMS_URL` | 선택 | DataHub GMS API URL |
| `DATAHUB_GMS_TOKEN` | 선택 | DataHub 인증 토큰 |
| `GOOGLE_API_KEY` | 선택 | Google Custom Search API 키 |
| `GOOGLE_SEARCH_ENGINE_ID` | 선택 | Google 검색 엔진 ID |

> `DATABASE_URL`, `MASTRA_SERVER_URL`은 docker-compose.yml에서 자동 override되므로 수정 불필요합니다.

> 선택 항목이 미설정이면 해당 Agent가 비활성화됩니다. `ANTHROPIC_API_KEY`만 있으면 기본 대화가 동작합니다.

### 2. 빌드 및 실행

```bash
docker compose up --build
```

처음 빌드 시 5~10분 소요됩니다 (Python MCP 서버 빌드 포함).

### 3. 접속

| URL | 설명 |
|-----|------|
| http://localhost:3000 | Chat UI |
| http://localhost:3000/a2a | A2A Testbed (Agent-to-Agent) |
| http://localhost:3000/a2a/settings | A2A 외부 서버 관리 |
| http://localhost:4111 | Mastra Studio (Agent/Workflow 디버깅) |

### 4. 동작 확인

- Chat UI에서 메시지를 보내면 Classifier가 의도를 분류하고 적절한 Agent를 호출합니다.
- MCP 환경변수가 설정되지 않은 Agent는 자동으로 비활성화됩니다.
- 첫 MCP 호출 시 lazy connect가 발생하므로 약간의 지연이 있을 수 있습니다.

## 로컬 개발 (Docker 없이)

터미널 2개가 필요합니다.

### 사전 요구사항

- Node.js >= 22.13.0
- PostgreSQL (로컬 또는 원격)
- (선택) Python 3 + `pip install mcp-atlassian mcp-server-datahub` — stdio MCP 서버용

### 셋업

```bash
# 의존성 설치 + google-search-mcp 설치 + DB 마이그레이션
npm run setup

# .env 파일에 DATABASE_URL을 로컬 PostgreSQL로 설정
# DATABASE_URL=postgresql://user:pass@localhost:5432/mastra
```

### 실행

```bash
# 터미널 1: Mastra Agent Server (port 4111, Studio 포함)
npm run mastra:dev

# 터미널 2: Next.js UI (port 3000)
npm run dev
```

## Docker Compose 상세

### 서비스 구성

```yaml
services:
  postgres:    # PostgreSQL 16 — 자동 healthcheck
  server:      # Mastra Agent Server — .env 참조
  web:         # Next.js UI — 시작 시 DB 자동 마이그레이션
```

### 주요 동작

- **DB 자동 마이그레이션**: web 컨테이너 시작 시 `drizzle-kit push`를 자동 실행하여 테이블을 생성합니다.
- **healthcheck**: PostgreSQL이 준비될 때까지 server/web이 대기합니다.
- **데이터 영속성**: `pgdata` 볼륨으로 PostgreSQL 데이터가 유지됩니다. 초기화하려면 `docker compose down -v`.

### 리빌드

코드 변경 후:

```bash
# 전체 리빌드
docker compose up --build

# server만 리빌드
docker compose build server && docker compose up
```

## MCP 서버 연결 방식

각 MCP 서버는 **HTTP** 또는 **stdio** 두 가지 방식으로 연결할 수 있습니다.

| MCP 서버 | HTTP (Kubernetes) | stdio (로컬/Docker) |
|----------|-------------------|---------------------|
| Atlassian | `MCP_ATLASSIAN_URL` 설정 | `CONFLUENCE_URL` + 인증 정보 설정 |
| DataHub | `MCP_DATAHUB_URL` 설정 | `DATAHUB_GMS_URL` + 토큰 설정 |
| Google Search | — | `GOOGLE_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` (항상 stdio) |

- HTTP 방식: 환경변수에 `MCP_*_URL`을 설정하면 Streamable HTTP로 연결합니다.
- stdio 방식: 개별 인증 정보를 설정하면 로컬 프로세스로 MCP 서버를 실행합니다.
- Docker 이미지에는 `mcp-atlassian`, `mcp-server-datahub`가 사전 설치되어 있습니다.

## A2A (Agent-to-Agent)

Mastra는 등록된 모든 Agent를 자동으로 A2A 엔드포인트로 노출합니다.

### 외부 A2A 서버 등록

1. http://localhost:3000/a2a/settings 에서 "서버 추가" 클릭
2. 서버 ID, 이름, Base URL 입력
3. 등록 즉시 Agent Discovery가 실행되어 발견된 Agent가 Testbed에 표시됩니다

> Docker 환경에서 로컬 Mastra 서버 자신을 등록할 때는 `http://server:4111` (Docker 내부 서비스명)을 사용하세요. `localhost`는 web 컨테이너 자신을 가리킵니다.

### API로 등록

```bash
curl -X POST http://localhost:3000/api/a2a/servers \
  -H "Content-Type: application/json" \
  -d '{"id":"my-server","name":"My Server","baseUrl":"http://server:4111"}'
```

## 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | Next.js UI 개발 서버 |
| `npm run mastra:dev` | Mastra Agent Server 개발 서버 (Studio 포함) |
| `npm run build` | Next.js 프로덕션 빌드 |
| `npm run mastra:build` | Mastra Server 빌드 |
| `npm run setup` | 의존성 설치 + DB 마이그레이션 (첫 셋업용) |
| `npm run db:push` | DB 스키마 동기화 (drizzle-kit push) |
| `docker compose up --build` | Docker로 전체 스택 실행 |

## 트러블슈팅

### MCP 서버 연결 실패

```
[McpConnectionManager] Failed to load DataHub fallback tools: Error: spawn uvx ENOENT
```

Docker 이미지에 MCP 서버가 설치되지 않은 경우입니다. `docker compose build --no-cache server`로 리빌드하세요.

### Mastra Studio가 빈 화면

DevTools → Application → Local Storage → `mastra-studio-config` 삭제 → 새로고침.

### Docker에서 A2A Discovery 실패

`http://localhost:4111` 대신 `http://server:4111` (Docker 서비스명)을 사용하세요. Docker 컨테이너 안에서 `localhost`는 해당 컨테이너 자신을 가리킵니다.

### DB 초기화

```bash
docker compose down -v   # 볼륨 삭제
docker compose up --build
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| Runtime | Node.js >= 22.13.0 |
| UI | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui |
| Agent Server | Mastra (Workflow 패턴) |
| LLM | Anthropic Claude Sonnet 4.5 (Classifier), Claude Haiku 4.5 (Worker/Judge) |
| MCP | @mastra/mcp (Model Context Protocol) |
| A2A | @a2a-js/sdk (Agent-to-Agent, JSON-RPC 2.0) |
| Storage | PostgreSQL (via @mastra/pg) |
| AI SDK | ai v6, @ai-sdk/react |

## 프로젝트 구조

```
mmiai/
├── src/
│   ├── app/                    # Next.js App Router (UI)
│   ├── components/             # React 컴포넌트
│   ├── lib/                    # DB, 유틸리티
│   └── mastra/                 # Mastra Agent Server
│       ├── agents/             # Classifier, Worker Agents
│       ├── a2a/                # A2A 인프라
│       ├── mcp/                # MCP Registry, Connection Manager
│       ├── scorers/            # LLM Judge (품질 평가)
│       ├── workflows/          # Chat Workflow + Steps
│       └── index.ts            # 서버 초기화 + /chat 핸들러
├── google-search-mcp/          # Google Search MCP 서버 (stdio)
├── Dockerfile.server           # Mastra Server 이미지
├── Dockerfile.web              # Next.js UI 이미지
├── docker-compose.yml          # 로컬 Docker 실행
└── .env.example                # 환경변수 템플릿
```
