import { test, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import { cacheGetOrSet, invalidateAuth, authCacheKey, modelCacheKey, deleteAllModelsByPattern } from "./cache.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
async function redisClient(): Promise<Redis | null> {
  if (redis !== null) return redis;
  try {
    const r = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => 100 });
    await r.connect();
    redis = r;
    return r;
  } catch {
    return null;
  }
}

after(() => { if (redis) redis.disconnect(); });

test("cacheGetOrSet calls loader on miss, uses cached on hit", async () => {
  const r = await redisClient();
  if (!r) return;
  const k = "test:guo";
  await r.del(k);
  let calls = 0;
  const loader = async () => { calls++; return { count: calls }; };
  await cacheGetOrSet(r, k, 30, loader);
  await cacheGetOrSet(r, k, 30, loader);
  assert.equal(calls, 1, "loader should be called once");
  await r.del(k);
});

test("cacheGetOrSet negative-caches null (bad-key DoS protection)", async () => {
  const r = await redisClient();
  if (!r) return;
  const k = "test:neg";
  await r.del(k);
  let calls = 0;
  const result1 = await cacheGetOrSet(r, k, 30, async () => { calls++; return null; });
  const result2 = await cacheGetOrSet(r, k, 30, async () => { calls++; return "fresh"; });
  assert.equal(calls, 1, "loader should not run on second call — sentinel cached");
  assert.equal(result1, null);
  assert.equal(result2, null, "negative cache returns null");
  await r.del(k);
});

test("cacheGetOrSet falls through to loader with no Redis", async () => {
  const v = await cacheGetOrSet(null, "test:null", 30, async () => "fresh");
  assert.equal(v, "fresh");
});

test("invalidateAuth deletes auth cache key", async () => {
  const r = await redisClient();
  if (!r) return;
  const hash = "abc123";
  const key = authCacheKey(hash);
  // populate via cacheGetOrSet
  await cacheGetOrSet(r, key, 30, async () => ({ user: "x" }));
  await invalidateAuth(r, hash);
  // second call should re-run loader
  let calls = 0;
  await cacheGetOrSet(r, key, 30, async () => { calls++; return { user: "y" }; });
  assert.equal(calls, 1, "cache should have been invalidated — loader ran again");
});

test("deleteAllModelsByPattern flushes all model:* keys but not auth:*", async () => {
  const r = await redisClient();
  if (!r) return;
  // populate model + auth keys via cacheGetOrSet
  await cacheGetOrSet(r, modelCacheKey("a"), 30, async () => ({ x: 1 }));
  await cacheGetOrSet(r, modelCacheKey("b"), 30, async () => ({ x: 2 }));
  await cacheGetOrSet(r, authCacheKey("zzz"), 30, async () => ({ x: 3 }));
  await deleteAllModelsByPattern(r);
  // model keys should be gone — loader reruns
  let modelCalls = 0;
  await cacheGetOrSet(r, modelCacheKey("a"), 30, async () => { modelCalls++; return null; });
  await cacheGetOrSet(r, modelCacheKey("b"), 30, async () => { modelCalls++; return null; });
  assert.equal(modelCalls, 2, "both model keys should have been invalidated");
  // auth key should still be cached — loader NOT called
  let authCalls = 0;
  await cacheGetOrSet(r, authCacheKey("zzz"), 30, async () => { authCalls++; return null; });
  assert.equal(authCalls, 0, "auth key should still be cached");
  await r.del(authCacheKey("zzz"));
});