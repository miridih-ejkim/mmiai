import { createHash } from "node:crypto";
import { getRedisClient, DEFAULT_TTL } from "./redis";

const CACHE_PREFIX = "mcp:tool:";

/**
 * 도구 ID + 입력 파라미터로 결정적 캐시 키 생성.
 */
function makeCacheKey(toolId: string, input: unknown): string {
  const sorted = JSON.stringify(input, Object.keys((input ?? {}) as Record<string, unknown>).sort());
  const hash = createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  return `${CACHE_PREFIX}${toolId}:${hash}`;
}

/**
 * 도구 딕셔너리의 각 execute()를 Redis 캐시로 래핑.
 *
 * Redis 미사용 시 원본 그대로 반환.
 * Redis 오류 시 원본 실행으로 폴스루 (절대 실패하지 않음).
 */
export function wrapToolsWithCache<T extends Record<string, any>>(
  tools: T,
  options?: { ttl?: number },
): T {
  const redis = getRedisClient();
  if (!redis) return tools;

  const ttl = options?.ttl ?? DEFAULT_TTL;
  const wrapped: Record<string, any> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== "function") {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute.bind(tool);
    const toolId = tool.id || name;

    wrapped[name] = Object.create(Object.getPrototypeOf(tool), {
      ...Object.getOwnPropertyDescriptors(tool),
      execute: {
        value: async (inputData: unknown, context: unknown) => {
          const cacheKey = makeCacheKey(toolId, inputData);

          // 캐시 조회
          try {
            const cached = await redis.get(cacheKey);
            if (cached !== null) {
              console.log(`[tool-cache] HIT ${toolId}`);
              return JSON.parse(cached);
            }
          } catch {
            // Redis 오류 → 원본 실행으로 폴스루
          }

          // 캐시 미스 → 원본 실행
          const result = await originalExecute(inputData, context);

          // 캐시 저장 (fire-and-forget)
          try {
            await redis.setex(cacheKey, ttl, JSON.stringify(result));
            console.log(`[tool-cache] SET ${toolId}`);
          } catch {
            // 저장 실패해도 무시
          }

          return result;
        },
        writable: true,
        configurable: true,
        enumerable: true,
      },
    });
  }

  return wrapped as T;
}
