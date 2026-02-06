/**
 * MCP Tool 결과 캐싱 (Redis)
 *
 * 서로 다른 스레드/Pod에서 동일한 tool을 같은 파라미터로 호출할 때
 * Redis 캐시에서 결과를 반환하여 외부 API 호출을 줄입니다.
 *
 * - Redis 기반: 멀티 Pod 환경에서 캐시 공유, 서버 재시작 후에도 유지
 * - TTL 자동 만료: Redis SETEX로 키별 자동 만료
 * - Fallback: Redis 연결 실패 시 캐싱 없이 원본 tool 직접 호출
 * - MCPServer(외부 노출)에는 적용하지 않고, Agent 주입 tools에만 적용
 */

import Redis from "ioredis";

const KEY_PREFIX = "tool-cache:";

interface ToolCacheOptions {
  /** 캐시 TTL (초). 기본값 300 (5분) */
  ttlSec?: number;
  /** 캐싱에서 제외할 도구 이름 목록 (쓰기/변경 도구 등) */
  exclude?: string[];
}

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      lazyConnect: true,
    });
    redis.connect().catch(() => {
      console.warn("[tool-cache] Redis 연결 실패, 캐싱 비활성화");
      redis = null;
    });
    return redis;
  } catch {
    return null;
  }
}

function makeKey(toolId: string, input: unknown): string {
  const obj = (input as Record<string, unknown>) ?? {};
  return `${KEY_PREFIX}${toolId}:${JSON.stringify(obj, Object.keys(obj).sort())}`;
}

/**
 * MCP 도구에 Redis 결과 캐싱 래퍼 적용
 *
 * 동일 파라미터 호출 시 Redis에서 결과 반환 (cross-thread, cross-pod)
 * Redis 연결 불가 시 캐싱 없이 원본 execute 직접 호출 (graceful degradation)
 */
export function withToolCache<T extends Record<string, any>>(
  tools: T,
  options?: ToolCacheOptions,
): T {
  const ttlSec = options?.ttlSec ?? 300;
  const excludeSet = new Set(options?.exclude ?? []);
  const wrapped = {} as Record<string, any>;

  for (const [name, tool] of Object.entries(tools)) {
    // execute 없거나 제외 목록에 있으면 캐싱 안 함
    if (!tool || typeof tool.execute !== "function" || excludeSet.has(name)) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (input: any, context?: any) => {
        const client = getRedis();
        if (client) {
          try {
            const key = makeKey(name, input);
            const cached = await client.get(key);
            if (cached !== null) return JSON.parse(cached);
          } catch {
            // Redis 읽기 실패 → 원본 호출로 fallback
          }
        }

        const result = await originalExecute(input, context);

        if (client) {
          try {
            const key = makeKey(name, input);
            await client.setex(key, ttlSec, JSON.stringify(result));
          } catch {
            // Redis 쓰기 실패 → 무시
          }
        }

        return result;
      },   
    };
  }

  return wrapped as T;
}
