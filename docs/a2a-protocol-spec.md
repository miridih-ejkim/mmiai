# A2A (Agent-to-Agent) 프로토콜 사양

> **프로토콜 버전**: 0.3.0 (v1.0 RC 개발 중)
> **관리 주체**: Linux Foundation (Google 기여)
> **공식 사이트**: https://a2a-protocol.org
> **참조 구현**: https://github.com/a2aproject/A2A

---

## 1. 개요

A2A(Agent-to-Agent) 프로토콜은 **서로 다른 프레임워크로 구축된 AI Agent 간의 통신과 상호 운용성**을 위한 개방형 표준이다.

Agent의 내부 구현을 노출하지 않으면서(opaque), 표준화된 인터페이스를 통해:
- Agent 능력 **발견**(Discovery)
- 상호작용 모드 **협상**(Negotiation)
- 협업 태스크 **관리**(Task Management)
- 정보 **교환**(Message Exchange)

을 수행할 수 있다.

### 1.1 설계 원칙

| 원칙 | 설명 |
|------|------|
| **단순성** | HTTP, JSON-RPC 2.0, SSE 등 기존 웹 표준 재사용 |
| **엔터프라이즈 준비** | 인증/인가, 보안 스킴, mTLS 지원 |
| **비동기 우선** | 장기 실행 태스크, Push Notification, 스트리밍 |
| **모달리티 무관** | 텍스트, 파일, 구조화 데이터 등 멀티모달 콘텐츠 교환 |

### 1.2 MCP와의 관계

| | MCP (Model Context Protocol) | A2A (Agent-to-Agent) |
|--|------|------|
| 대상 | **Tool** (함수 단위) | **Agent** (추론 단위) |
| 통신 방향 | Agent → Tool (단방향) | Agent ↔ Agent (양방향) |
| 상태 관리 | Stateless | Task 상태 머신 (7 states) |
| 디스커버리 | 정적 설정 | `/.well-known/agent-card` |
| 공통점 | JSON-RPC 2.0 + SSE | JSON-RPC 2.0 + SSE |

MCP는 Agent에게 **도구(손)**를 제공하고, A2A는 Agent에게 **동료(다른 Agent)**를 제공한다. 두 프로토콜은 경쟁이 아닌 **보완** 관계.

---

## 2. 핵심 개념

### 2.1 Agent

A2A 호환 엔드포인트를 노출하는 독립 시스템.

- **Client Agent**: 요청을 시작하는 쪽
- **Server Agent (Remote Agent)**: 태스크를 처리하는 쪽

### 2.2 Task

작업의 기본 단위. 고유 ID를 가지며 정의된 상태 머신을 따라 진행된다.

```
Task {
  id: string              // 서버 생성, 고유 식별자
  contextId: string       // 대화 세션 그룹핑
  status: TaskStatus      // 현재 상태
  messages: Message[]     // 대화 이력
  artifacts: Artifact[]   // 생성된 결과물
  createdTime: string     // ISO 8601
  updatedTime: string     // ISO 8601
  metadata?: object       // 확장 메타데이터
}
```

### 2.3 Message

Agent 간 통신의 단일 턴. 멀티모달 Parts로 구성.

```
Message {
  role: "user" | "agent"
  messageId: string
  parts: Part[]                // 멀티모달 콘텐츠
  contextId?: string           // 대화 세션 식별
  taskId?: string              // 연결된 태스크
  referenceTaskIds?: string[]  // 참조 태스크 목록
  extensions?: string[]        // 사용된 확장 URI
  metadata?: object
}
```

### 2.4 Part (메시지 콘텐츠 단위)

Message와 Artifact를 구성하는 최소 콘텐츠 단위.

| Part 타입 | kind | 내용 | 예시 |
|-----------|------|------|------|
| **TextPart** | `"text"` | 텍스트 콘텐츠 | `{ kind: "text", text: "안녕하세요" }` |
| **FilePart** | `"file"` | 파일 참조 (URI 또는 base64) | `{ kind: "file", file: { uri: "...", mimeType: "application/pdf" } }` |
| **DataPart** | `"data"` | 구조화 데이터 (JSON) | `{ kind: "data", data: { key: "value" } }` |

### 2.5 Artifact

Agent가 생성한 결과물 — 문서, 이미지, 구조화 데이터 등. Message와 구조는 유사하지만, **출력(output) 전용**이라는 의미적 차이.

### 2.6 AgentCard

Agent의 신원, 능력, 엔드포인트, 인증 요구사항을 기술하는 JSON 메타데이터. Agent 디스커버리의 핵심.

### 2.7 Context

서버가 생성하는 식별자로, 관련된 Task/Message를 논리적으로 그룹핑하여 대화 연속성을 유지.

---

## 3. Task 상태 머신

### 3.1 상태 정의

| 상태 | 설명 | 터미널 |
|------|------|--------|
| `working` | 태스크 처리 중 | No |
| `input-required` | 클라이언트 추가 입력 대기 | No |
| `auth-required` | 인증/인가 자격증명 대기 | No |
| `completed` | 성공적 완료 | **Yes** |
| `failed` | 오류로 종료 | **Yes** |
| `canceled` | 클라이언트/Agent에 의한 취소 | **Yes** |
| `rejected` | 서버가 태스크 거부 (정책 등) | **Yes** |

### 3.2 상태 전이 다이어그램

```
  SendMessage
       │
       ▼
  ┌─────────┐
  │ working │◄──────────────────────┐
  └────┬────┘                       │
       │                            │
       ├────────┐     ┌─────────────┤
       │        │     │             │
       ▼        ▼     │             │
  ┌────────┐ ┌────────┴──┐  ┌──────┴──────┐
  │input-  │ │  auth-     │  │ (클라이언트  │
  │required│ │  required  │  │  입력/인증)  │
  └────┬───┘ └────┬──────┘  └─────────────┘
       │          │
       └────┬─────┘
            │ (처리 계속 또는 종료)
            │
   ┌────────┼────────┬──────────┐
   │        │        │          │
   ▼        ▼        ▼          ▼
┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐
│compl-│ │failed│ │canceled│ │rejected│
│eted │ │      │ │        │ │        │
└──────┘ └──────┘ └────────┘ └────────┘
  (터미널 상태 — 이후 작업 불가)
```

### 3.3 MMIAI HITL과의 대응

| A2A 상태 | MMIAI Workflow 대응 |
|----------|-------------------|
| `working` | Step 실행 중 |
| `input-required` | `suspend()` — clarify/ambiguous HITL |
| `completed` | Workflow 완료 (`synthesize-response` 이후) |
| `failed` | Step 실행 에러 |
| `canceled` | (미구현) |

---

## 4. AgentCard (Agent 디스커버리)

### 4.1 디스커버리 메커니즘

```
GET https://<agent-host>/.well-known/agent-card
Accept: application/json

→ 200 OK
Content-Type: application/json
{ AgentCard JSON }
```

### 4.2 AgentCard 전체 구조

```typescript
interface AgentCard {
  // === 필수 필드 ===
  id: string;                        // 고유 Agent 식별자
  name: string;                      // 표시 이름
  provider: AgentProvider;           // 제공자 정보
  capabilities: AgentCapabilities;   // 지원 기능
  interfaces: AgentInterface[];      // 프로토콜 바인딩 목록

  // === 선택 필드 ===
  description?: string;              // Agent 설명
  skills?: AgentSkill[];             // 수행 가능한 스킬 목록
  securitySchemes?: SecurityScheme[];// 인증 스킴
  security?: string[][];             // 필수 인증 조합
  extensions?: AgentExtension[];     // 지원 확장
  signature?: AgentCardSignature;    // 카드 서명 (JWS)
  version?: string;                  // Agent 버전
  defaultInputModes?: string[];      // 지원 입력 MIME 타입
  defaultOutputModes?: string[];     // 지원 출력 MIME 타입
}

interface AgentCapabilities {
  streaming?: boolean;          // SSE 스트리밍 지원
  pushNotifications?: boolean;  // 웹훅 Push 지원
  extendedAgentCard?: boolean;  // 인증 후 확장 카드 제공
  stateTransitionHistory?: boolean; // 상태 변경 이력 노출
}

interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  inputModes?: string[];    // 스킬별 입력 모드 오버라이드
  outputModes?: string[];   // 스킬별 출력 모드 오버라이드
}

interface AgentInterface {
  type: "json-rpc" | "grpc" | "http" | "custom";
  url: string;
}
```

### 4.3 Public Card vs Extended Card

| | Public Card | Extended Card |
|--|-------------|---------------|
| 접근 | 인증 없이 `/.well-known/agent-card` | 인증 후 `GetExtendedAgentCard` |
| 내용 | 기본 신원, 능력, 보안 요구사항 | 추가 스킬, 세부 구성, 민감 정보 |
| 용도 | 초기 디스커버리 | 인증된 세션 내 상세 정보 |
| 캐싱 | 자유롭게 캐시 가능 | 인증 세션 동안만 유효 |

---

## 5. 프로토콜 바인딩

### 5.1 바인딩 요약

| 바인딩 | 요구 수준 | 전송 | 직렬화 | 스트리밍 |
|--------|----------|------|--------|---------|
| **JSON-RPC 2.0** | SHOULD (기본값) | HTTPS | JSON | SSE |
| **HTTP+JSON REST** | MAY | HTTPS | JSON | SSE |
| **gRPC** | MAY | HTTP/2 + TLS | Protocol Buffers | gRPC Server Streaming |

> `preferredTransport` 미지정 시 기본값: **JSON-RPC**

### 5.2 JSON-RPC 바인딩 (기본)

단일 엔드포인트에 모든 메서드를 라우팅. `method` 필드로 구분.

**요청 형식**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "a2a_sendMessage",
  "params": {
    "message": {
      "role": "user",
      "messageId": "msg-001",
      "parts": [{ "kind": "text", "text": "데이터 테이블 조회해줘" }]
    },
    "configuration": {
      "acceptedOutputModes": ["text/plain", "application/json"],
      "blocking": true
    }
  }
}
```

**응답 형식 (성공)**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "id": "task-abc",
    "contextId": "ctx-123",
    "status": { "state": "completed" },
    "artifacts": [
      { "parts": [{ "kind": "text", "text": "조회 결과..." }] }
    ]
  }
}
```

**응답 형식 (에러)**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "error": {
    "code": -32001,
    "message": "Task not found",
    "data": { "taskId": "task-xyz" }
  }
}
```

**서비스 파라미터** (HTTP 헤더로 전달):
```
A2A-Version: 0.3
A2A-Extensions: https://example.com/ext/v1
```

### 5.3 HTTP+JSON REST 바인딩

RESTful URL 패턴으로 메서드를 매핑.

| 연산 | HTTP 메서드 | 경로 |
|------|-----------|------|
| SendMessage | POST | `/agents/{agent}/tasks` |
| SendStreamingMessage | POST | `/agents/{agent}/tasks?stream=true` |
| GetTask | GET | `/agents/{agent}/tasks/{taskId}` |
| ListTasks | GET | `/agents/{agent}/tasks` |
| CancelTask | POST | `/agents/{agent}/tasks/{taskId}:cancel` |
| SubscribeToTask | GET | `/agents/{agent}/tasks/{taskId}:subscribe?stream=true` |
| GetAgentCard | GET | `/.well-known/agent-card` |
| GetExtendedAgentCard | GET | `/agents/{agent}/extendedCard` |

**페이지네이션 파라미터**:
- `pageSize`: 1~100 (기본 50)
- `pageToken`: 커서 (opaque string)
- `statusTimestampAfter`: ISO 8601 타임스탬프 필터

### 5.4 gRPC 바인딩

Protocol Buffers 기반. `spec/a2a.proto`에 정의.

- **요구 수준**: MAY (선택적)
- **적합한 경우**: 기존 gRPC 인프라가 있는 조직
- **서비스 파라미터**: gRPC metadata로 전달 (case-insensitive)
- **스트리밍**: gRPC native server streaming (`stream` 키워드)
- **에러 코드**: 표준 gRPC status codes로 매핑

### 5.5 바인딩 간 상호운용성

여러 바인딩을 지원하는 Agent는 다음을 보장해야 한다:

- 모든 바인딩에서 **동일한 연산과 기능** 제공
- 동일 요청에 대해 **의미적으로 동등한 결과** 반환
- AgentCard의 `interfaces` 필드에 모든 지원 바인딩 선언

---

## 6. 전체 연산 (Operations)

### 6.1 메서드 목록

| 카테고리 | 연산 | JSON-RPC method | 설명 |
|---------|------|-----------------|------|
| **메시지** | SendMessage | `a2a_sendMessage` | 동기 메시지 전송 → Task 또는 Message 응답 |
| | SendStreamingMessage | `a2a_sendStreamingMessage` | 스트리밍 메시지 전송 → SSE 스트림 |
| **태스크** | GetTask | `a2a_getTask` | 태스크 상태 조회 |
| | ListTasks | `a2a_listTasks` | 태스크 목록 조회 (필터/페이지네이션) |
| | CancelTask | `a2a_cancelTask` | 태스크 취소 요청 |
| | SubscribeToTask | `a2a_subscribeToTask` | 기존 태스크에 SSE 구독 |
| **Push 알림** | CreatePushNotificationConfig | `a2a_createTaskPushNotificationConfig` | 웹훅 등록 |
| | GetPushNotificationConfig | `a2a_getTaskPushNotificationConfig` | 웹훅 조회 |
| | ListPushNotificationConfigs | `a2a_listTaskPushNotificationConfigs` | 웹훅 목록 |
| | DeletePushNotificationConfig | `a2a_deleteTaskPushNotificationConfig` | 웹훅 삭제 |
| **디스커버리** | GetAgentCard | (HTTP GET) | 공개 AgentCard 조회 |
| | GetExtendedAgentCard | `a2a_getExtendedAgentCard` | 인증 후 확장 카드 조회 |

### 6.2 통신 패턴

```
[패턴 1: 동기 (Blocking)]
Client ──SendMessage──→ Server
Client ←──Task/Message──── Server
  (blocking: true — 완료까지 대기)

[패턴 2: 스트리밍 (SSE)]
Client ──SendStreamingMessage──→ Server
Client ←──SSE Stream──────────── Server
  event: TaskStatusUpdateEvent   (상태 변경)
  event: TaskArtifactUpdateEvent (결과물 생성)
  event: Message                 (최종 응답)

[패턴 3: 비동기 (Push Notification)]
Client ──SendMessage──→ Server    (즉시 반환)
Client ──CreatePushNotificationConfig──→ Server
  ... (시간 경과) ...
Server ──POST webhook──→ Client   (상태 변경 시)
```

### 6.3 스트리밍 상세

**SSE 이벤트 래퍼 (StreamResponse)**:
```typescript
type StreamResponse =
  | { task: Task }                           // 태스크 전체 스냅샷
  | { message: Message }                     // Agent 메시지
  | { statusUpdate: TaskStatusUpdateEvent }  // 상태 변경
  | { artifactUpdate: TaskArtifactUpdateEvent } // 결과물 업데이트
```

**SSE 형식**:
```
event: statusUpdate
data: {"state":"working","taskId":"task-abc"}

event: artifactUpdate
data: {"taskId":"task-abc","artifact":{"parts":[{"kind":"text","text":"중간 결과..."}]}}

event: statusUpdate
data: {"state":"completed","taskId":"task-abc"}
```

**스트림 종료 조건**:
- Task가 터미널 상태에 도달 (completed, failed, canceled, rejected)
- 연결 중단
- 하나의 스트림 종료가 다른 스트림에 영향을 주지 않음 (다중 구독 지원)

### 6.4 Push Notification

```typescript
interface PushNotificationConfig {
  id?: string;                     // 서버 생성 ID
  url: string;                     // 웹훅 엔드포인트
  token?: string;                  // 태스크/세션 고유 토큰
  authentication?: {
    schemes: string[];             // "Basic" | "Bearer" 등
    credentials?: string;          // 인증 자격증명
  };
  eventTypes?: [                   // 구독할 이벤트 타입
    "TASK_STATUS_UPDATE",
    "TASK_ARTIFACT_UPDATE"
  ];
}
```

서버는 등록된 웹훅 URL로 `StreamResponse` 객체를 HTTP POST로 전달한다. 재시도 정책은 구현체에 위임.

---

## 7. 멀티턴 대화 (Context Management)

### 7.1 contextId와 taskId

```
대화 세션 (contextId: "ctx-001")
  ├── Task 1 (taskId: "task-aaa") — "데이터 테이블 목록 조회"
  │     └── completed
  ├── Task 2 (taskId: "task-bbb") — "users 테이블 스키마 확인"
  │     ├── input-required ("어떤 DB의 users 테이블인가요?")
  │     └── completed (추가 입력 후)
  └── Task 3 (taskId: "task-ccc") — "위 테이블의 리니지 확인"
        └── working...
```

| 식별자 | 생성 | 용도 |
|--------|------|------|
| `contextId` | 서버 생성 (클라이언트 제공 시 유지) | 관련 Task 그룹핑, 대화 연속성 |
| `taskId` | 서버 생성 (항상) | 개별 작업 식별 |

### 7.2 대화 흐름

1. 클라이언트가 `contextId` 없이 첫 메시지 전송 → 서버가 `contextId` 생성
2. 이후 메시지에 동일 `contextId` 포함 → 같은 대화 세션으로 그룹핑
3. `taskId`로 기존 태스크에 추가 입력 가능 (`input-required` 상태에서)
4. `contextId`와 `taskId` 불일치 시 서버가 거부

---

## 8. 인증과 보안

### 8.1 전송 보안

- HTTPS **필수** (모든 HTTP 기반 바인딩)
- TLS 1.2 이상 (1.3 권장)
- 서버 인증서 검증 필수

### 8.2 인증 스킴

AgentCard의 `securitySchemes`에 선언:

| 스킴 | type | 설명 |
|------|------|------|
| **API Key** | `apiKey` | 헤더/쿼리/쿠키에 API 키 전달 |
| **HTTP Auth** | `http` | Basic, Bearer, 커스텀 스킴 |
| **OAuth 2.0** | `oauth2` | Authorization Code, Client Credentials, Device Code |
| **OpenID Connect** | `openIdConnect` | OIDC Discovery 기반 |
| **Mutual TLS** | `mutualTls` | 클라이언트 인증서 검증 |

### 8.3 인가 규칙

- Agent는 클라이언트별 **리소스 단위 인가** 실행해야 함 (MUST)
- 접근 불가 리소스의 존재를 노출하면 안 됨 (not found ≈ forbidden)
- RBAC 또는 동등한 접근 제어 구현 권장

### 8.4 AgentCard 서명 (선택)

```typescript
interface AgentCardSignature {
  signature: string;     // JWS 서명 값
  algorithm: string;     // 서명 알고리즘
  keyId?: string;        // 공개 키 참조
}
```

클라이언트는 서명을 검증하여 AgentCard의 진위를 확인할 수 있다.

---

## 9. 에러 체계

### 9.1 표준 JSON-RPC 에러

| 코드 | 이름 | 설명 |
|------|------|------|
| -32700 | ParseError | 유효하지 않은 JSON |
| -32600 | InvalidRequest | 유효하지 않은 요청 객체 |
| -32601 | MethodNotFound | 메서드 존재하지 않음 |
| -32602 | InvalidParams | 유효하지 않은 파라미터 |
| -32603 | InternalError | 내부 JSON-RPC 에러 |
| -32000~-32099 | ServerError | 서버 에러 (예약 범위) |

### 9.2 A2A 확장 에러

| 코드 | 이름 | 설명 |
|------|------|------|
| -32001 | TaskNotFoundError | 태스크 ID 무효/만료/접근 불가 |
| -32002 | TaskNotCancelableError | 취소 불가 상태 |
| -32003 | PushNotificationNotSupportedError | Push 미지원 |
| -32004 | UnsupportedOperationError | 미지원 연산 |
| -32005 | ContentTypeNotSupportedError | 미지원 미디어 타입 |
| -32006 | InvalidAgentResponseError | 스펙 비준수 응답 |
| — | ExtendedAgentCardNotConfiguredError | 확장 카드 미구성 |
| — | ExtensionSupportRequiredError | 필수 확장 미지원 |
| — | VersionNotSupportedError | A2A 버전 미지원 |

---

## 10. 콘텐츠 협상

### 10.1 출력 모드

클라이언트가 `SendMessageConfiguration.acceptedOutputModes`로 선호 형식 선언:

```json
{
  "configuration": {
    "acceptedOutputModes": ["text/plain", "application/json", "image/png"]
  }
}
```

Agent는 클라이언트 선호를 기반으로 응답 형식을 조정해야 한다 (SHOULD). 미지원 형식 요청 시 `ContentTypeNotSupportedError` 반환.

### 10.2 Blocking 모드

```json
{
  "configuration": {
    "blocking": true,           // 완료까지 대기
    "historyLength": 10         // 최근 메시지 N개 포함
  }
}
```

- `blocking: true` → 터미널/중단 상태까지 대기 후 응답
- `blocking: false` (기본) → 태스크 생성 즉시 반환

---

## 11. 확장 메커니즘

### 11.1 Extension 선언

```typescript
interface AgentExtension {
  uri: string;          // 고유 확장 식별자 (URI)
  description?: string;
  required: boolean;    // 클라이언트 필수 지원 여부
  version?: string;
  params?: object;      // 확장 설정
}
```

### 11.2 확장 협상

1. AgentCard에 `extensions` 필드로 지원 확장 선언
2. 클라이언트가 `A2A-Extensions` 헤더에 지원 확장 URI 나열
3. `required: true` 확장을 클라이언트가 미지원 시 `ExtensionSupportRequiredError`

---

## 12. 프로토콜 스택 요약

```
┌──────────────────────────────────────────────────┐
│  애플리케이션 계층                                 │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ AgentCard   │ │ Task 상태   │ │ Message/Parts│  │
│  │ (디스커버리) │ │ (7 states) │ │ (멀티모달)    │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
├──────────────────────────────────────────────────┤
│  메시지 형식                                      │
│  ┌────────────────────────────────────────────┐  │
│  │ JSON-RPC 2.0                               │  │
│  │ method: a2a_sendMessage | a2a_getTask ...  │  │
│  │ + A2A 에러 코드 확장 (-32001 ~ -32006)     │  │
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  스트리밍 계층                                    │
│  ┌────────────────────────────────────────────┐  │
│  │ SSE (Server-Sent Events)                   │  │
│  │ Content-Type: text/event-stream            │  │
│  │ events: statusUpdate, artifactUpdate,      │  │
│  │         message, task                      │  │
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  전송 계층                                        │
│  ┌────────────────────────────────────────────┐  │
│  │ HTTPS (TLS 1.2+)                           │  │
│  │ JSON-RPC (기본) · HTTP REST · gRPC (선택)   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## 참고 자료

- [A2A Protocol Specification (공식)](https://a2a-protocol.org/latest/specification/)
- [A2A GitHub Repository](https://github.com/a2aproject/A2A)
- [Google A2A 발표 블로그](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [@a2a-js/sdk (TypeScript 구현)](https://www.npmjs.com/package/@a2a-js/sdk)
- [RFC 2119 (요구 수준 키워드)](https://www.rfc-editor.org/rfc/rfc2119)
