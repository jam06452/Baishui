import type { RedisClient } from "./redis.js";
import type { ProviderKey } from "@baishui/db";

// ponytail: circuit breaker + rate-limit tracking in Redis (ephemeral).
// PG (provider_key_health) is the durable backup; Redis is the hot path.
// Lose Redis = cold start of health state, just less optimal for ~30s.

const COOLDOWN_TTL_S = 300;          // 5 min default cooldown after rate-limit
const CIRCUIT_FAILURE_THRESHOLD = 5; // open after 5 errors
const CIRCUIT_WINDOW_S = 60;         // ...within 60s
const CIRCUIT_OPEN_TTL_S = 60;       // stay open 60s before half-open probe

function k(keyId: string, suffix: string) {
  return `pk:${keyId}:${suffix}`;
}

export interface KeyHealth {
  available: boolean;
  cooldownUntil: number;   // epoch ms, 0 if none
  circuitOpen: boolean;
  inflight: number;
}

export async function getKeyHealth(redis: RedisClient | null, keyId: string): Promise<KeyHealth> {
  if (!redis) return { available: true, cooldownUntil: 0, circuitOpen: false, inflight: 0 };
  const [cooldown, circuit, inflight] = await redis.mget(
    k(keyId, "cooldown"), k(keyId, "circuit"), k(keyId, "inflight"),
  );
  return {
    available: !cooldown && !circuit,
    cooldownUntil: cooldown ? Number(cooldown) : 0,
    circuitOpen: Boolean(circuit),
    inflight: inflight ? Number(inflight) : 0,
  };
}

export async function incrInflight(redis: RedisClient | null, keyId: string): Promise<void> {
  if (!redis) return;
  await redis.incr(k(keyId, "inflight"));
}

export async function decrInflight(redis: RedisClient | null, keyId: string): Promise<void> {
  if (!redis) return;
  const v = await redis.decr(k(keyId, "inflight"));
  if (v < 0) await redis.set(k(keyId, "inflight"), "0");
}

/** Pick the best available key from a pool.
 *  ponytail: round-robin among healthy keys via Redis INCR counter. Falls back
 *  to least-inflight as a tiebreaker. Keys in cooldown or circuit-open are skipped.
 *  If all keys are unhealthy, returns null. */
export async function selectKey(
  redis: RedisClient | null,
  keys: ProviderKey[],
): Promise<ProviderKey | null> {
  if (keys.length === 0) return null;
  if (!redis) return keys[0]!;
  const healths = await Promise.all(keys.map(async (k) => ({ key: k, health: await getKeyHealth(redis, k.id) })));
  const available = healths.filter((h) => h.health.available);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0]!.key;
  // round-robin: INCR a shared counter, mod by available count
  const idx = await redis.incr("rr:selectKey");
  const pick = available[idx % available.length]!;
  // tiebreak: if the picked key has high inflight, prefer the least-inflight
  const minInflight = Math.min(...available.map((a) => a.health.inflight));
  if (pick.health.inflight > minInflight + 3) {
    available.sort((a, b) => a.health.inflight - b.health.inflight);
    return available[0]!.key;
  }
  return pick.key;
}

/** Record a successful request: clear failure counter, stamp last success. */
export async function recordSuccess(redis: RedisClient | null, keyId: string): Promise<void> {
  if (!redis) return;
  await redis.del(k(keyId, "failures"), k(keyId, "circuit"), k(keyId, "cooldown"));
}

/** Record an error. Opens circuit if threshold hit. Sets cooldown on rate-limit. */
export async function recordError(
  redis: RedisClient | null,
  keyId: string,
  status: number,
  retryAfterMs?: number,
): Promise<void> {
  if (!redis) return;

  if (status === 429) {
    const cooldownMs = retryAfterMs ?? COOLDOWN_TTL_S * 1000;
    await redis.set(k(keyId, "cooldown"), String(Date.now() + cooldownMs), "PX", cooldownMs);
    return;
  }
  if (status === 401 || status === 403) {
    // ponytail: auth error = key bad; long cooldown (1h) so it's effectively disabled
    await redis.set(k(keyId, "cooldown"), String(Date.now() + 3600000), "PX", 3600000);
    return;
  }
  if (status >= 500) {
    const failures = await redis.incr(k(keyId, "failures"));
    await redis.expire(k(keyId, "failures"), CIRCUIT_WINDOW_S);
    if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
      await redis.set(k(keyId, "circuit"), "1", "EX", CIRCUIT_OPEN_TTL_S);
    }
  }
}