import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";

// ponytail: analytics reads raw request_logs directly. usage_rollups exist for
// Phase 6+ if hot reads become a problem; for now, request_logs with indexes + the
// time-bounded WHERE clause is cheap enough on a self-hosted load.

export function analyticsRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "member", "admin", "owner"));

  function getRange(c: import("hono").Context) {
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();
    const from = c.req.query("from") ? new Date(c.req.query("from")!) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return { from, to };
  }

  function userFilter(user: import("@baishui/db").User) {
    if (user.role === "member" || user.role === "viewer") return sql`AND user_id = ${user.id}`;
    return sql``;
  }

  // ── Aggregated totals ──────────────────────────────────────
  app.get("/summary", async (c) => {
    const { from, to } = getRange(c);
    const result = await rt.db.db.execute(sql`
      SELECT count(*)::int AS requests,
             COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
             COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
             COALESCE(sum(cost_estimate), 0)::numeric AS cost,
             count(*) FILTER (WHERE status >= 400)::int AS errors
      FROM request_logs
      WHERE created_at >= ${from} AND created_at < ${to} ${userFilter(c.get("user"))}
    `);
    return c.json({ summary: result.rows?.[0] ?? null });
  });

  // ── Time series (per minute or hour) ────────────────────────
  app.get("/timeseries", async (c) => {
    const { from, to } = getRange(c);
    const granularity = c.req.query("granularity") === "hour" ? "hour" : "minute";
    const result = await rt.db.db.execute(sql`
      SELECT
        date_trunc(${granularity}, created_at) AS bucket,
        count(*)::int AS requests,
        COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
        count(*) FILTER (WHERE status >= 400)::int AS errors
      FROM request_logs
      WHERE created_at >= ${from} AND created_at < ${to} ${userFilter(c.get("user"))}
      GROUP BY 1
      ORDER BY 1
    `);
    return c.json({ timeseries: result.rows ?? [] });
  });

  // ── Breakdown by model ──────────────────────────────────────
  app.get("/by-model", async (c) => {
    const { from, to } = getRange(c);
    const result = await rt.db.db.execute(sql`
      SELECT m.upstream_id AS model, m.display_name,
             count(*)::int AS requests,
             COALESCE(sum(r.input_tokens), 0)::bigint AS input_tokens,
             COALESCE(sum(r.output_tokens), 0)::bigint AS output_tokens,
             COALESCE(sum(r.cost_estimate), 0)::numeric AS cost
      FROM request_logs r
      LEFT JOIN models m ON r.model_id = m.id
      WHERE r.created_at >= ${from} AND r.created_at < ${to} ${userFilter(c.get("user"))}
      GROUP BY m.upstream_id, m.display_name
      ORDER BY requests DESC
      LIMIT 50
    `);
    return c.json({ by_model: result.rows ?? [] });
  });

  return app;
}