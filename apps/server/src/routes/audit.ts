import { Hono } from "hono";
import { desc } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";
import { auditLog } from "@baishui/db";

export function auditRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "admin"));

  app.get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const rows = await rt.db.db
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        meta: auditLog.meta,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);
    // ponytail: bigserial id is BigInt — JSON.stringify can't handle it; stringify once with a replacer.
    const entries = rows.map((r) => ({ ...r, id: String(r.id) }));
    return c.json({ entries });
  });

  return app;
}