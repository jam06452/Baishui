import { Hono } from "hono";
import { sql, eq, and } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";
import { getAllStrategies, setStrategy, type LBStrategy } from "../lib/load-balancing.js";
import { getKeyHealth } from "../lib/key-health.js";
import { models, providers, providerKeys, requestLogs } from "@baishui/db";

// ponytail: load balancing dashboard. Shows models that exist on 2+ providers
// (auto-fallback candidates), their current strategy, per-provider health, and
// request distribution from request_logs.

export function loadBalancingRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "member", "admin", "owner"));

  // ── List all multi-provider models with health + request counts ──
  // ponytail: group by display_name only — different upstream_ids across
  // providers for the same logical model should be grouped together for
  // load balancing. e.g. "k2.6-normal" on DO (upstream: kimi-k2.6) and
  // LLMSolutions (upstream: k2.6-normal) should show as ONE entry with 2 providers.
  app.get("/", async (c) => {
    const result = await rt.db.db.execute(sql`
      SELECT
        m.display_name AS model_name,
        array_agg(DISTINCT m.upstream_id) AS upstream_ids,
        count(DISTINCT p.id) AS provider_count,
        array_agg(DISTINCT p.id) AS provider_ids,
        array_agg(DISTINCT p.name) AS provider_names,
        array_agg(m.id) AS model_ids_per_provider
      FROM models m
      INNER JOIN providers p ON m.provider_id = p.id
      WHERE m.enabled = true AND p.enabled = true
      GROUP BY m.display_name
      ORDER BY provider_count DESC, m.display_name
    `);
    const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];

    // Get strategies from Redis
    const strategies = await getAllStrategies(rt.redis);

    // For each model, get per-provider request counts (last 24h) + key health
    const enriched = await Promise.all(rows.map(async (row) => {
      const modelName = row.model_name as string;
      const providerIds = row.provider_ids as string[];
      const providerNames = row.provider_names as string[];

      // Request counts per provider for this model (last 24h)
      const reqResult = await rt.db.db.execute(sql`
        SELECT p.name AS provider_name, count(*)::int AS requests
        FROM request_logs r
        INNER JOIN providers p ON r.provider_id = p.id
        INNER JOIN models m ON r.model_id = m.id
        WHERE m.display_name = ${modelName} AND r.created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY p.name
      `);
      const reqCounts: Record<string, number> = {};
      ((reqResult as unknown as { rows?: Array<{ provider_name: string; requests: number }> }).rows ?? []).forEach((r) => {
        reqCounts[r.provider_name] = r.requests;
      });

      // Key health per provider
      const providerHealth = await Promise.all(providerIds.map(async (pid, i) => {
        const keys = await rt.db.db
          .select({ id: providerKeys.id, label: providerKeys.label, status: providerKeys.status })
          .from(providerKeys)
          .where(and(eq(providerKeys.providerId, pid), eq(providerKeys.status, "active")));
        const keyHealth = await Promise.all(keys.map(async (k) => {
          const h = await getKeyHealth(rt.redis, k.id);
          return {
            label: k.label,
            healthy: h.available,
            inflight: h.inflight,
            cooldownMs: h.cooldownUntil > 0 ? Math.max(0, h.cooldownUntil - Date.now()) : 0,
            circuitOpen: h.circuitOpen,
          };
        }));
        return {
          providerId: pid,
          providerName: providerNames[i],
          keyCount: keys.length,
          requests: reqCounts[providerNames[i]!] ?? 0,
          keys: keyHealth,
        };
      }));

      return {
        model: modelName,
        upstreamIds: row.upstream_ids,
        providerCount: row.provider_count,
        strategy: strategies[modelName] ?? "failover",
        providers: providerHealth,
      };
    }));

    return c.json({ models: enriched });
  });

  // ── Set strategy for a model ───────────────────────────────
  app.patch("/strategy", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.model || !body?.strategy) {
      return c.json({ error: { message: "model and strategy required", type: "bad_request" } }, 400);
    }
    const strategy = body.strategy as LBStrategy;
    if (strategy !== "failover" && strategy !== "round_robin") {
      return c.json({ error: { message: "strategy must be 'failover' or 'round_robin'", type: "bad_request" } }, 400);
    }
    await setStrategy(rt.redis, body.model, strategy);
    return c.json({ ok: true, model: body.model, strategy });
  });

  return app;
}
