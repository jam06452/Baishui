import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireManagementKey, requireRole, type AppVars } from "../lib/auth.js";
import { generateApiKey, generateManagementKey, hashApiKey } from "../lib/api-key.js";
import { apiKeys, users, managementKeys, providers, auditLog } from "@baishui/db";

// ponytail: management API for automation/scripts. Uses mgmt- prefixed keys
// stored in DB with scoped access. No session needed.
// First management key must be created via dashboard (admin session) — after
// that, the management API can create more keys using an existing mgmt key.

export function managementRoutes(rt: Runtime): Hono {
  const app = new Hono();

  // ── Management key CRUD ─────────────────────────────────────
  // List all management keys (auth: mgmt key OR admin session)
  app.get("/keys", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const rows = await rt.db.db
      .select({
        id: managementKeys.id, keyPrefix: managementKeys.keyPrefix, name: managementKeys.name,
        scopes: managementKeys.scopes, lastUsedAt: managementKeys.lastUsedAt,
        revokedAt: managementKeys.revokedAt, createdAt: managementKeys.createdAt,
      })
      .from(managementKeys)
      .orderBy(managementKeys.createdAt);
    return c.json({ keys: rows });
  });

  // Create management key — ponytail: allow admin session OR existing mgmt key.
  // This breaks the chicken-and-egg: first key created via dashboard, rest via API.
  app.post("/keys", async (c, next) => {
    // Try mgmt key auth first
    const auth = c.req.header("authorization");
    if (auth?.startsWith("Bearer mgmt-")) {
      return requireManagementKey(rt.db.db, "keys")(c, next);
    }
    // Fall back to dashboard session auth (admin+)
    return requireRole(rt.db.db, "admin")(c, next);
  }, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name) return c.json({ error: { message: "name required", type: "bad_request" } }, 400);
    const { key, hash, prefix } = generateManagementKey();
    const scopes = body.scopes ?? ["keys"];
    const actorId = c.get("user" as never) as { id: string } | undefined;
    const [created] = await rt.db.db
      .insert(managementKeys)
      .values({ keyHash: hash, keyPrefix: prefix, name: body.name, scopes, createdBy: actorId?.id ?? null })
      .returning();
    return c.json({ key, id: created!.id, prefix: created!.keyPrefix, name: created!.name, scopes: created!.scopes }, 201);
  });

  // Revoke management key
  app.delete("/keys/:id", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const id = c.req.param("id");
    await rt.db.db.update(managementKeys).set({ revokedAt: new Date() }).where(eq(managementKeys.id, id));
    return c.json({ ok: true });
  });

  // ── User API key management ─────────────────────────────────
  // List all user API keys
  app.get("/user-keys", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const rows = await rt.db.db
      .select({
        id: apiKeys.id, keyPrefix: apiKeys.keyPrefix, name: apiKeys.name, scopes: apiKeys.scopes,
        userId: apiKeys.userId, rateLimitRpm: apiKeys.rateLimitRpm,
        tokenLimitDaily: apiKeys.tokenLimitDaily, costLimitDaily: apiKeys.costLimitDaily,
        lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(apiKeys.createdAt);
    return c.json({ keys: rows });
  });

  // Create user API key (by user email)
  app.post("/user-keys", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.email) return c.json({ error: { message: "email required", type: "bad_request" } }, 400);
    const [user] = await rt.db.db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    if (!user) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);
    const { key, hash, prefix } = generateApiKey();
    const [created] = await rt.db.db
      .insert(apiKeys)
      .values({
        userId: user.id, keyHash: hash, keyPrefix: prefix,
        name: body.name ?? null, scopes: body.scopes ?? ["chat", "models"],
        rateLimitRpm: body.rateLimitRpm ?? null,
        tokenLimitDaily: body.tokenLimitDaily ?? null,
        costLimitDaily: body.costLimitDaily ?? null,
      })
      .returning();
    return c.json({ key, id: created!.id, prefix: created!.keyPrefix, name: created!.name, scopes: created!.scopes,
      rateLimitRpm: created!.rateLimitRpm, tokenLimitDaily: created!.tokenLimitDaily, costLimitDaily: created!.costLimitDaily }, 201);
  });

  // Update API key limits
  app.patch("/user-keys/:id", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: { message: "body required", type: "bad_request" } }, 400);
    const updates: Record<string, unknown> = {};
    if (body.rateLimitRpm !== undefined) updates.rateLimitRpm = body.rateLimitRpm;
    if (body.tokenLimitDaily !== undefined) updates.tokenLimitDaily = body.tokenLimitDaily;
    if (body.costLimitDaily !== undefined) updates.costLimitDaily = body.costLimitDaily;
    if (body.name !== undefined) updates.name = body.name;
    const [updated] = await rt.db.db.update(apiKeys).set(updates).where(eq(apiKeys.id, id)).returning();
    if (!updated) return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
    return c.json({ key: { id: updated.id, name: updated.name, rateLimitRpm: updated.rateLimitRpm,
      tokenLimitDaily: updated.tokenLimitDaily, costLimitDaily: updated.costLimitDaily } });
  });

  // Revoke user API key
  app.delete("/user-keys/:id", requireManagementKey(rt.db.db, "keys"), async (c) => {
    const id = c.req.param("id");
    await rt.db.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    return c.json({ ok: true });
  });

  // ── Users (read-only for management) ────────────────────────
  app.get("/users", requireManagementKey(rt.db.db, "users"), async (c) => {
    const rows = await rt.db.db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
      .from(users)
      .orderBy(users.createdAt);
    return c.json({ users: rows });
  });

  // ── Providers (read-only for management) ────────────────────
  app.get("/providers", requireManagementKey(rt.db.db, "providers"), async (c) => {
    const rows = await rt.db.db.select().from(providers).orderBy(providers.createdAt);
    return c.json({ providers: rows });
  });

  return app;
}