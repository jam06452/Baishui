import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { invalidateAuth } from "../lib/cache.js";
import { apiKeys, auditLog } from "@baishui/db";

export function apiKeyRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "member", "admin", "owner"));

  // List own API keys
  app.get("/", async (c) => {
    const rows = await rt.db.db
      .select({
        id: apiKeys.id, keyPrefix: apiKeys.keyPrefix, name: apiKeys.name,
        scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, c.get("user").id))
      .orderBy(apiKeys.createdAt);
    return c.json({ keys: rows });
  });

  // Create API key (returns full key once)
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { key, hash, prefix } = generateApiKey();
    const [created] = await rt.db.db
      .insert(apiKeys)
      .values({
        userId: c.get("user").id,
        keyHash: hash,
        keyPrefix: prefix,
        name: body.name ?? null,
        scopes: body.scopes ?? ["chat", "models"],
      })
      .returning();
    await rt.db.db.insert(auditLog).values({
      actorUserId: c.get("user").id, action: "api_key.create", targetType: "api_key", targetId: created!.id,
    });
    return c.json({ key, id: created!.id, prefix, name: created!.name, scopes: created!.scopes }, 201);
  });

  // Revoke (soft delete)
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const actor = c.get("user");
    const [row] = await rt.db.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!row) return c.json({ error: { message: "not found", type: "not_found" } }, 404);
    // owner can revoke any; others only their own
    if (row.userId !== actor.id && actor.role !== "owner" && actor.role !== "admin") {
      return c.json({ error: { message: "forbidden", type: "forbidden" } }, 403);
    }
    await rt.db.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    // ponytail: invalidate the auth cache so the revoked key stops working
    // immediately — without this, the 60s TTL would let it through.
    await invalidateAuth(rt.redis, row.keyHash);
    await rt.db.db.insert(auditLog).values({
      actorUserId: actor.id, action: "api_key.revoke", targetType: "api_key", targetId: id,
    });
    return c.json({ ok: true });
  });

  return app;
}