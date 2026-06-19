import { Hono } from "hono";
import { sql, desc } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";

// ponytail: OpenRouter-style request log. Joins request_logs with models +
// providers + users for display. Supports filtering by status (errors only)
// and pagination.

export function requestRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "member", "admin", "owner"));

  app.get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const errorsOnly = c.req.query("errors") === "true";
    const user = c.get("user");
    const userFilter = user.role === "member" || user.role === "viewer"
      ? sql`AND r.user_id = ${user.id}`
      : sql``;
    const errorFilter = errorsOnly ? sql`AND r.status >= 400` : sql``;

    const result = await rt.db.db.execute(sql`
      SELECT
        r.id,
        r.status,
        r.latency_ms,
        r.input_tokens,
        r.output_tokens,
        r.cost_estimate,
        r.stream,
        r.error_code,
        r.error_msg,
        r.created_at,
        m.upstream_id AS model,
        m.display_name AS model_name,
        p.name AS provider_name,
        sm.upstream_id AS served_by_model,
        u.email AS user_email
      FROM request_logs r
      LEFT JOIN models m ON r.model_id = m.id
      LEFT JOIN providers p ON r.provider_id = p.id
      LEFT JOIN models sm ON r.served_by_model_id = sm.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE 1=1 ${userFilter} ${errorFilter}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const rows = (result as { rows?: unknown[] }).rows ?? [];
    return c.json({ requests: rows });
  });

  // ── Stats summary for the requests page header ──────────────
  app.get("/stats", async (c) => {
    const user = c.get("user");
    const userFilter = user.role === "member" || user.role === "viewer"
      ? sql`AND user_id = ${user.id}`
      : sql``;

    const result = await rt.db.db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status >= 400)::int AS errors,
        count(*) FILTER (WHERE status = 200)::int AS successes,
        COALESCE(sum(input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(sum(output_tokens), 0)::bigint AS total_output_tokens,
        COALESCE(avg(latency_ms), 0)::int AS avg_latency_ms,
        COALESCE(max(latency_ms), 0)::int AS max_latency_ms
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours' ${userFilter}
    `);

    const row = (result as { rows?: unknown[] }).rows?.[0] ?? null;
    return c.json({ stats: row });
  });

  // ── Request detail (single row with all joined info) ───────
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const userFilter = user.role === "member" || user.role === "viewer"
      ? sql`AND r.user_id = ${user.id}`
      : sql``;
    const result = await rt.db.db.execute(sql`
      SELECT
        r.id, r.status, r.latency_ms, r.input_tokens, r.output_tokens,
        r.cost_estimate, r.stream, r.error_code, r.error_msg, r.created_at,
        m.upstream_id AS model, m.display_name AS model_name,
        p.name AS provider_name,
        sm.upstream_id AS served_by_model,
        u.email AS user_email,
        pk.label AS key_label
      FROM request_logs r
      LEFT JOIN models m ON r.model_id = m.id
      LEFT JOIN providers p ON r.provider_id = p.id
      LEFT JOIN models sm ON r.served_by_model_id = sm.id
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN provider_keys pk ON r.provider_key_id = pk.id
      WHERE r.id = ${Number(id)} ${userFilter}
      LIMIT 1
    `);
    const row = (result as { rows?: unknown[] }).rows?.[0] ?? null;
    if (!row) return c.json({ error: { message: "not found", type: "not_found" } }, 404);
    return c.json({ request: row });
  });

  return app;
}