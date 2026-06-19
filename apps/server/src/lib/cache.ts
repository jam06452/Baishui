import type { RedisClient } from "./redis.js";
import { eq } from "drizzle-orm";
import { apiKeys, type Db } from "@baishui/db";

// ponytail: tier-1 Redis cache for hot-path lookups. Cache miss falls through
// to DB. Admin mutations call invalidate() on the relevant keys. Short TTLs
// (60s default) cap staleness if an invalidation is missed (process crash, etc).
// Negative caching (SENTINEL) prevents bad-key DoS — a revoked/nonexistent key
// is cached as null so repeated lookups don't hit the DB.

const PREFIX_AUTH = "auth:";
const PREFIX_MODEL = "model:";
const SENTINEL = "__null__";

async function cacheGet<T>(redis: RedisClient | null, key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const v = await redis.get(key);
    if (!v) return null;
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

async function cacheSet(redis: RedisClient | null, key: string, value: unknown, ttlSec: number): Promise<void> {
  if (!redis || ttlSec <= 0) return;
  try {
    const payload = value === null ? SENTINEL : value;
    await redis.set(key, JSON.stringify(payload), "EX", ttlSec);
  } catch {}
}

export async function cacheGetOrSet<T>(
  redis: RedisClient | null,
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T | typeof SENTINEL>(redis, key);
  if (cached !== null) return cached === SENTINEL ? (null as T) : cached;
  const fresh = await loader();
  await cacheSet(redis, key, fresh, ttlSec);
  return fresh;
}

export async function invalidateAuth(redis: RedisClient | null, apiKeyHash: string): Promise<void> {
  if (!redis) return;
  await redis.del(`${PREFIX_AUTH}${apiKeyHash}`).catch(() => {});
}

export function authCacheKey(apiKeyHash: string) {
  return `${PREFIX_AUTH}${apiKeyHash}`;
}

export function modelCacheKey(modelId: string) {
  return `${PREFIX_MODEL}${encodeURIComponent(modelId)}`;
}

export async function invalidateAllKeysForUser(redis: RedisClient | null, db: Db, userId: string): Promise<void> {
  if (!redis) return;
  try {
    const keys = await db.select({ hash: apiKeys.keyHash }).from(apiKeys).where(eq(apiKeys.userId, userId));
    if (keys.length === 0) return;
    await redis.del(...keys.map((k) => `${PREFIX_AUTH}${k.hash}`));
  } catch {}
}

export async function deleteAllModelsByPattern(redis: RedisClient | null): Promise<void> {
  if (!redis) return;
  let cursor = "0";
  try {
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${PREFIX_MODEL}*`, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {}
  await redis.del("v1:models").catch(() => {});
}