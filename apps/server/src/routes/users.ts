import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, hashPassword, type AppVars } from "../lib/auth.js";
import { invalidateAllKeysForUser } from "../lib/cache.js";
import { users, sessions, auditLog, apiKeys } from "@baishui/db";

export function userRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "admin"));

  // ── List users ──────────────────────────────────────────────
  app.get("/", async (c) => {
    const rows = await rt.db.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        forcePasswordChange: users.forcePasswordChange,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);
    return c.json({ users: rows });
  });

  // ── Create user ─────────────────────────────────────────────
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.email || !body?.password || !body?.role) {
      return c.json({ error: { message: "email, password, role required", type: "bad_request" } }, 400);
    }
    if (!["member", "admin", "viewer"].includes(body.role)) {
      return c.json({ error: { message: "role must be member, admin, or viewer", type: "bad_request" } }, 400);
    }
    const passwordHash = await hashPassword(body.password);
    try {
      const [created] = await rt.db.db
        .insert(users)
        .values({
          email: body.email.toLowerCase(),
          name: body.name ?? null,
          role: body.role,
          passwordHash,
          forcePasswordChange: true,
          emailVerifiedAt: new Date(),
        })
        .returning();
      await rt.db.db.insert(auditLog).values({
        actorUserId: c.get("user").id,
        action: "user.create",
        targetType: "user",
        targetId: created!.id,
        meta: { email: created!.email, role: created!.role },
      });
      return c.json({ user: { id: created!.id, email: created!.email, name: created!.name, role: created!.role } }, 201);
    } catch (err) {
      if (String(err).includes("unique")) {
        return c.json({ error: { message: "email already exists", type: "conflict" } }, 409);
      }
      throw err;
    }
  });

  // ── Update user ─────────────────────────────────────────────
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: { message: "body required", type: "bad_request" } }, 400);

    const [existing] = await rt.db.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);

    // ponytail: owner role is immutable — can't promote to owner or demote the owner.
    if (existing.role === "owner" && body.role && body.role !== "owner") {
      return c.json({ error: { message: "cannot change owner role", type: "forbidden" } }, 403);
    }
    if (body.role && !["member", "admin", "viewer"].includes(body.role)) {
      return c.json({ error: { message: "role must be member, admin, or viewer", type: "bad_request" } }, 400);
    }

    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role;

    if (Object.keys(updates).length === 0) {
      return c.json({ user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role } });
    }

    await rt.db.db.update(users).set(updates).where(eq(users.id, id));
    await rt.db.db.insert(auditLog).values({
      actorUserId: c.get("user").id,
      action: "user.update",
      targetType: "user",
      targetId: id,
      meta: updates,
    });
    return c.json({ user: { id: existing.id, email: existing.email, name: body.name ?? existing.name, role: body.role ?? existing.role } });
  });

  // ── Delete user ─────────────────────────────────────────────
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const actor = c.get("user");

    if (id === actor.id) {
      return c.json({ error: { message: "cannot delete yourself", type: "forbidden" } }, 403);
    }

    const [existing] = await rt.db.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);
    if (existing.role === "owner") {
      return c.json({ error: { message: "cannot delete owner", type: "forbidden" } }, 403);
    }

    // sessions cascade-delete via FK; explicit delete on users
    // ponytail: also invalidate the deleted user's auth cache. API keys
    // cascade-deleted via FK but their auth cache entries linger for up to
    // CACHE_TTL_AUTH_S (60s) — during which a deleted user's key would still
    // authenticate. Flush them now.
    await invalidateAllKeysForUser(rt.redis, rt.db.db, id);
    await rt.db.db.delete(users).where(eq(users.id, id));
    await rt.db.db.insert(auditLog).values({
      actorUserId: actor.id,
      action: "user.delete",
      targetType: "user",
      targetId: id,
      meta: { email: existing.email },
    });
    return c.json({ ok: true });
  });

  return app;
}