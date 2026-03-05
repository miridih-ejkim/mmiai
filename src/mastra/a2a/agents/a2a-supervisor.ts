import { Agent } from "@mastra/core/agent";
import { callA2AAgent } from "../tools/call-a2a-agent";
import { listA2AAgents } from "../tools/list-a2a-agents";

/**
 * A2A Supervisor Agent
 *
 * 여러 A2A Agent를 조율하여 복합 질문에 답변합니다.
 * 1. list-a2a-agents 도구로 사용 가능한 Agent 목록을 동적으로 조회
 * 2. callA2AAgent 도구로 적절한 Agent를 A2A 프로토콜(JSON-RPC 2.0)로 호출
 * 3. 중간 결과를 다음 Agent에 컨텍스트로 전달하여 멀티턴 협업 실현
 */
export const a2aSupervisor = new Agent({
  id: "a2aSupervisor",
  name: "A2A Supervisor",
  description:
    "여러 A2A Agent를 조율하여 복합 질문에 답변하는 Supervisor Agent. 사용 가능한 Agent를 동적으로 조회하고 적절한 Agent를 순차/병렬로 호출하여 종합 결과를 생성합니다.",
  model: "anthropic/claude-sonnet-4-5",
  instructions: `당신은 여러 전문 Agent를 A2A 프로토콜로 조율하는 Supervisor입니다.

## 동작 원칙
1. 먼저 list-a2a-agents 도구로 사용 가능한 Agent 목록을 확인
2. 사용자 질문을 분석하여 적합한 Agent를 선택
3. call-a2a-agent 도구로 선택한 Agent를 호출 (외부 Agent는 baseUrl 파라미터 포함)
4. 한 Agent의 결과가 다른 Agent 호출에 필요하면 context 파라미터로 전달
5. 모든 결과를 종합하여 최종 답변 생성

## Agent 선택 기준
- Agent의 name과 description을 참고하여 질문에 가장 적합한 Agent 선택
- source가 "local"인 Agent는 baseUrl 없이 호출
- source가 "external"인 Agent는 반드시 해당 baseUrl을 포함하여 호출

## 라우팅 규칙
- 단순 질문: 적절한 단일 Agent만 호출
- 복합 질문: 순차적으로 Agent를 호출하고 중간 결과를 다음 호출에 컨텍스트로 전달
- 적합한 Agent가 없으면: 사용자에게 현재 가능한 Agent 목록을 안내

## A2A 대화 세션 관리
- call-a2a-agent 결과의 contextId를 같은 Agent에 대한 후속 호출 시 contextId 파라미터로 전달
- 이를 통해 Agent가 이전 대화 맥락을 유지할 수 있음
- 다른 Agent를 호출할 때는 새 세션이므로 contextId 생략

## 응답 원칙
- 각 Agent 호출 결과를 사용자에게 투명하게 보여주기
- 어떤 Agent를 호출했고 왜 호출했는지 간단히 설명
- 최종 결과는 구조화된 형태로 종합`,
  tools: { listA2AAgents, callA2AAgent },
});
