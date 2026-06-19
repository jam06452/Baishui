import type { RedisClient } from "./redis.js";

// ponytail: per-model load balancing strategy stored in Redis (no schema change).
// failover = provider 1 gets all traffic, provider 2 only on error (default).
// round_robin = distribute evenly across all healthy providers.
// Keyed by model display name / upstream ID — same key the client sends.

const PREFIX = "lb:strategy:";

export type LBStrategy = "failover" | "round_robin";

export async function getStrategy(redis: RedisClient | null, modelName: string): Promise<LBStrategy> {
  if (!redis) return "failover";
  try {
    const v = await redis.get(PREFIX + encodeURIComponent(modelName));
    return v === "round_robin" ? "round_robin" : "failover";
  } catch {
    return "failover";
  }
}

export async function setStrategy(redis: RedisClient | null, modelName: string, strategy: LBStrategy): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(PREFIX + encodeURIComponent(modelName), strategy);
  } catch {}
}

export async function getAllStrategies(redis: RedisClient | null): Promise<Record<string, LBStrategy>> {
  if (!redis) return {};
  try {
    let cursor = "0";
    const result: Record<string, LBStrategy> = {};
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", PREFIX + "*", "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        const vals = await redis.mget(...keys);
        keys.forEach((k, i) => {
          const name = decodeURIComponent(k.slice(PREFIX.length));
          result[name] = vals[i] === "round_robin" ? "round_robin" : "failover";
        });
      }
    } while (cursor !== "0");
    return result;
  } catch {
    return {};
  }
}

/** Shuffle candidates for round-robin. Uses Redis INCR as a counter.
 *  failover = return as-is (priority order preserved). */
export async function applyStrategy<T>(
  redis: RedisClient | null,
  modelName: string,
  candidates: T[],
): Promise<T[]> {
  if (candidates.length <= 1) return candidates;
  const strategy = await getStrategy(redis, modelName);
  if (strategy === "failover") return candidates;
  // round_robin: rotate the list by a counter so each request hits a different provider
  if (!redis) return candidates;
  try {
    const idx = await redis.incr("rr:provider:" + encodeURIComponent(modelName));
    const rotated = [...candidates];
    for (let i = 0; i < idx % candidates.length; i++) rotated.push(rotated.shift()!);
    return rotated;
  } catch {
    return candidates;
  }
}
