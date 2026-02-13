import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
const DEFAULT_TTL = 300; // 5 minutes

let redis: Redis | null = null;

/**
 * Redis 클라이언트 (lazy singleton).
 * REDIS_URL 미설정 시 null 반환 (캐싱 비활성화).
 */
export function getRedisClient(): Redis | null {
  if (!REDIS_URL) return null;
  if (redis) return redis;

  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redis.on("error", (err) => {
    console.warn("[redis-cache] connection error:", err.message);
  });

  redis.connect().catch(() => {});

  return redis;
}

/**
 * Redis 연결 해제 (graceful shutdown).
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
}

export { DEFAULT_TTL };
