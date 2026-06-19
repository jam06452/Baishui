import { Hono } from "hono";
import type { Runtime } from "../lib/runtime.js";

export function healthRoutes(rt: Runtime): Hono {
  const app = new Hono();

  // liveness: process is up
  app.get("/healthz", (c) => c.json({ status: "ok", uptime: process.uptime() }));

  // readiness: dependencies reachable
  app.get("/readyz", async (c) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // PostgreSQL
    const pgStart = Date.now();
    try {
      await rt.db.pool.query("SELECT 1");
      checks.postgres = { ok: true, latencyMs: Date.now() - pgStart };
    } catch (err) {
      checks.postgres = { ok: false, error: (err as Error).message };
    }

    // Redis (ephemeral — failure is degraded, not fatal)
    const redisStart = Date.now();
    if (!rt.redis) {
      checks.redis = { ok: false, error: "not configured" };
    } else {
      try {
        const pong = await rt.redis.ping();
        checks.redis = { ok: pong === "PONG", latencyMs: Date.now() - redisStart };
      } catch (err) {
        checks.redis = { ok: false, error: (err as Error).message };
      }
    }

    const allOk = checks.postgres.ok && (checks.redis.ok || !rt.config.REDIS_URL);
    const httpStatus = allOk ? 200 : 503;
    return c.json({ status: allOk ? "ok" : "degraded", checks }, httpStatus);
  });

  return app;
}