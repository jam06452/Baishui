import { test, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import { selectKey, incrInflight, decrInflight, recordSuccess, recordError, getKeyHealth } from "./key-health.js";

// ponytail: integration tests use a real Redis (already in docker-compose).
// No Redis available = tests skipped. Run with `docker compose up -d redis` first.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
async function getRedis(): Promise<Redis | null> {
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

// force-disconnect on test completion so node:test exits
after(() => { if (redis) redis.disconnect(); });

const mockKey = (id: string) => ({ id, providerId: "p1" } as never);

test("selectKey distributes via round-robin across healthy keys", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("rr:selectKey", "pk:rr1:cooldown", "pk:rr2:cooldown", "pk:rr1:circuit", "pk:rr2:circuit", "pk:rr1:inflight", "pk:rr2:inflight");
  const keys = [mockKey("rr1"), mockKey("rr2")];
  const picks: string[] = [];
  for (let i = 0; i < 10; i++) {
    const sel = await selectKey(r, keys);
    picks.push(sel!.id);
  }
  // Both keys should be picked roughly equally
  const c1 = picks.filter((p) => p === "rr1").length;
  const c2 = picks.filter((p) => p === "rr2").length;
  assert.ok(c1 >= 3 && c2 >= 3, `round-robin should distribute: rr1=${c1} rr2=${c2}`);
  await r.del("rr:selectKey");
});

test("selectKey with no redis = first key", async () => {
  const keys = [mockKey("a"), mockKey("b")];
  const result = await selectKey(null, keys);
  assert.ok(result !== null);
  assert.equal(result.id, "a");
});

test("selectKey with no keys = null", async () => {
  assert.equal(await selectKey(null, []), null);
});

test("incrInflight then decrInflight nets to zero", async () => {
  const r = await getRedis();
  if (!r) return; // skip if no redis
  await r.del("pk:k1:inflight");
  await incrInflight(r, "k1");
  await incrInflight(r, "k1");
  let v = await r.get("pk:k1:inflight");
  assert.equal(v, "2");
  await decrInflight(r, "k1");
  await decrInflight(r, "k1");
  v = await r.get("pk:k1:inflight");
  assert.equal(v, "0");
});

test("decrInflight floors at 0", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k2:inflight");
  await decrInflight(r, "k2");
  const v = await r.get("pk:k2:inflight");
  assert.equal(v, "0");
});

test("recordError 429 sets cooldown", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k3:cooldown");
  await recordError(r, "k3", 429, 5000);
  const cooldown = await r.get("pk:k3:cooldown");
  assert.ok(cooldown !== null);
  await r.del("pk:k3:cooldown");
});

test("recordError 401 sets long cooldown", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k4:cooldown");
  await recordError(r, "k4", 401);
  const cooldown = await r.get("pk:k4:cooldown");
  assert.ok(cooldown !== null);
  await r.del("pk:k4:cooldown");
});

test("recordError 5xx opens circuit after threshold", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k5:failures", "pk:k5:circuit");
  for (let i = 0; i < 5; i++) await recordError(r, "k5", 500);
  const circuit = await r.get("pk:k5:circuit");
  assert.equal(circuit, "1");
  await r.del("pk:k5:failures", "pk:k5:circuit");
});

test("recordSuccess clears cooldown/circuit/failures", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.set("pk:k6:cooldown", "1");
  await r.set("pk:k6:circuit", "1");
  await r.set("pk:k6:failures", "5");
  await recordSuccess(r, "k6");
  assert.equal(await r.get("pk:k6:cooldown"), null);
  assert.equal(await r.get("pk:k6:circuit"), null);
  assert.equal(await r.get("pk:k6:failures"), null);
});

test("selectKey avoids cooldown'd key", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k7:cooldown", "pk:k8:cooldown");
  await recordError(r, "k7", 429, 30000); // k7 in cooldown
  const keys = [mockKey("k7"), mockKey("k8")];
  const selected = await selectKey(r, keys);
  assert.ok(selected !== null);
  assert.equal(selected.id, "k8");
  await r.del("pk:k7:cooldown", "pk:k8:cooldown");
});

test("selectKey returns null when all keys in cooldown", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k9:cooldown", "pk:k10:cooldown");
  await recordError(r, "k9", 429, 30000);
  await recordError(r, "k10", 429, 30000);
  const selected = await selectKey(r, [mockKey("k9"), mockKey("k10")]);
  assert.equal(selected, null);
  await r.del("pk:k9:cooldown", "pk:k10:cooldown");
});

test("getKeyHealth returns available when no constraints", async () => {
  const r = await getRedis();
  if (!r) return;
  await r.del("pk:k11:cooldown", "pk:k11:circuit", "pk:k11:inflight");
  const h = await getKeyHealth(r, "k11");
  assert.equal(h.available, true);
  assert.equal(h.circuitOpen, false);
  assert.equal(h.cooldownUntil, 0);
});