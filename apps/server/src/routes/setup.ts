import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { users, auditLog } from "@baishui/db";
import {
  hashPassword,
  createSession,
  setSessionCookie,
} from "../lib/auth.js";

// ponytail: setup wizard endpoint. No auth required, but only works when no
// users exist. Once the first owner is created, /api/setup returns 403 and the
// landing page redirects to the login. Self-locks after first use.

const OK_STATUS = { ok: true } as const;

export function setupRoutes(rt: Runtime): Hono {
  const app = new Hono();

  // GET /api/setup/status — { needed: true if no users exist }
  app.get("/status", async (c) => {
    const [row] = await rt.db.db
      .select({ c: sql<number>`count(*)::int` })
      .from(users);
    const needed = !row || row.c === 0;
    return c.json({ needed });
  });

  // POST /api/setup — create the first owner. Race-safe: atomically inserts
  // the owner only if zero users exist; concurrent POSTs will fail safely.
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return c.json({ error: { message: "email and password required", type: "bad_request" } }, 400);
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return c.json({ error: { message: "password must be at least 8 chars", type: "bad_request" } }, 400);
    }
    const email = String(body.email).toLowerCase().trim().slice(0, 320);
    if (email.length === 0 || !email.includes("@")) {
      return c.json({ error: { message: "valid email required", type: "bad_request" } }, 400);
    }
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) || null : null;

    // ponytail: race-safe first-owner gate. Use a sentinel row keyed on a
    // fixed UUID (so only one client can ever win the insert) + ON CONFLICT
    // DO NOTHING. Losers fall through to a fresh count() which will be > 0.
    // Equivalent to: SELECT 1 WHERE NOT EXISTS (...) then INSERT — but in one
    // statement via CTE.
    const result = await rt.db.db.execute(sql`
      WITH inserted AS (
        INSERT INTO users (id, email, name, password_hash, role, email_verified_at, force_password_change, created_at)
        SELECT
          '00000000-0000-0000-0000-000000000001',
          ${email},
          ${name},
          ${await hashPassword(body.password)},
          'owner',
          now(),
          false,
          now()
        WHERE NOT EXISTS (SELECT 1 FROM users)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, email
      )
      SELECT
        (SELECT count(*)::int FROM users) AS user_count,
        EXISTS (SELECT 1 FROM inserted) AS we_created
    `);
    const row = (result as unknown as { rows?: { user_count: number; we_created: boolean }[] }).rows?.[0];
    if (!row || !row.we_created) {
      return c.json({ error: { message: "setup already complete", type: "forbidden" } }, 403);
    }

    // Fetch the row we just created (id is the fixed sentinel)
    const [created] = await rt.db.db
      .select()
      .from(users)
      .where(sql`id = '00000000-0000-0000-0000-000000000001'`)
      .limit(1);

    await rt.db.db.insert(auditLog).values({
      actorUserId: created!.id,
      action: "setup.create_owner",
      targetType: "user",
      targetId: created!.id,
      meta: { email: created!.email },
    });

    const { token } = await createSession(rt.db.db, created!.id, {
      ip: c.req.header("x-forwarded-for") ?? undefined,
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    setSessionCookie(c, token);
    await rt.db.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, created!.id));

    return c.json(OK_STATUS, 201);
  });

  return app;
}