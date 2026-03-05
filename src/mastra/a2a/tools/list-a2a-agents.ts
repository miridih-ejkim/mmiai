import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAvailableA2AAgents } from "../a2a-registry";

/**
 * A2A Agent 목록 조회 도구
 *
 * Supervisor Agent가 이 도구를 호출하여 현재 사용 가능한 모든 A2A Agent를 확인합니다.
 * 로컬 Agent와 외부 서버에서 발견된 Agent를 포함합니다.
 */
export const listA2AAgents = createTool({
  id: "list-a2a-agents",
  description:
    "현재 사용 가능한 모든 A2A Agent 목록을 조회합니다. 로컬 및 외부 서버에 등록된 Agent를 포함합니다. 사용자 질문에 답하기 위해 어떤 Agent를 호출할 수 있는지 확인할 때 사용합니다.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    agents: z.array(
      z.object({
        agentId: z.string(),
        name: z.string(),
        description: z.string(),
        source: z.enum(["local", "external"]),
        baseUrl: z.string().optional(),
        version: z.string().optional(),
        capabilities: z
          .object({
            streaming: z.boolean().optional(),
            pushNotifications: z.boolean().optional(),
          })
          .optional(),
        skills: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
  execute: async () => {
    const agents = await getAvailableA2AAgents();
    return {
      agents: agents.map((a) => ({
        agentId: a.agentId,
        name: a.name,
        description: a.description,
        source: a.source,
        ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
        ...(a.version ? { version: a.version } : {}),
        ...(a.capabilities ? { capabilities: a.capabilities } : {}),
        ...(a.skills?.length ? { skills: a.skills } : {}),
      })),
    };
  },
});
