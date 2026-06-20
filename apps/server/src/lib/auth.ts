import { randomBytes, createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { eq, and, gt } from "drizzle-orm";
import type { Db, User, Session } from "@baishui/db";
import { sessions, users, managementKeys, type ManagementKey } from "@baishui/db";
import { hashApiKey } from "./api-key.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_SLIDE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "baishui_session";
const PKCE_COOKIE = "github_pkce";
const PKCE_TTL_S = 600;

export type UserRole = User["role"];

export interface AppVars {
  Variables: {
    user: User;
    session: Session;
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  db: Db,
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const now = new Date();
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    .returning();
  return { token, session: session! };
}

async function lookupSession(
  db: Db,
  token: string,
): Promise<{ user: User; session: Session } | null> {
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // ponytail: sliding session — single update when near expiry, no refresh-token table.
  if (row.session.expiresAt.getTime() - now.getTime() < SESSION_SLIDE_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), refreshedAt: now })
      .where(eq(sessions.id, row.session.id));
  }
  return { user: row.user, session: row.session };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(password: string, hashStr: string | null): Promise<boolean> {
  if (!hashStr) return false;
  return verify(hashStr, password);
}

// ponytail: Secure flag based on env, not NODE_ENV — HTTP self-host needs
// Secure=false or browsers silently reject the session cookie.
function cookieSecure(): boolean {
  const flag = process.env.SESSION_COOKIE_SECURE ?? "auto";
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Parameters<typeof setCookie>[0]): void {
  setCookie(c, SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function setPkceCookie(c: Parameters<typeof setCookie>[0], value: string): void {
  setCookie(c, PKCE_COOKIE, value, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: PKCE_TTL_S,
  });
}

export function getPkceCookie(c: Parameters<typeof getCookie>[0]): string | undefined {
  return getCookie(c, PKCE_COOKIE);
}

export function clearPkceCookie(c: Parameters<typeof setCookie>[0]): void {
  setCookie(c, PKCE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Middleware: authenticate via session cookie, enforce role. owner always passes. */
export function requireRole(db: Db, ...allowed: UserRole[]): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: { message: "unauthorized", type: "unauthorized" } }, 401);

    const result = await lookupSession(db, token);
    if (!result) return c.json({ error: { message: "unauthorized", type: "unauthorized" } }, 401);

    c.set("user", result.user);
    c.set("session", result.session);

    if (result.user.role === "owner") {
      await next();
      return;
    }
    if (!allowed.includes(result.user.role)) {
      return c.json({ error: { message: "forbidden", type: "forbidden" } }, 403);
    }
    await next();
  };
}

/** Middleware: reject cross-origin mutations. SameSite=Lax + Origin check. */
export function csrfMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      await next();
      return;
    }
    const origin = c.req.header("Origin");
    // ponytail: no Origin header = non-browser client (curl, API) — allow.
    // SameSite=Lax + Origin check only protects browser-driven CSRF.
    if (!origin) {
      await next();
      return;
    }
    const host = c.req.header("Host");
    try {
      if (new URL(origin).host === host) {
        await next();
        return;
      }
    } catch {
      // fall through to reject
    }
    return c.json({ error: { message: "cross-origin not allowed", type: "forbidden" } }, 403);
  };
}

/** Check if an email is allowed for OAuth auto-create based on domain allowlist. */
export function isEmailAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.includes(domain));
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── Management API key auth ──────────────────────────────────
// ponytail: mgmt- prefixed keys for automation. Scoped to actions.
export function requireManagementKey(db: Db, ...requiredScopes: string[]): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header("authorization");
    if (!auth?.startsWith("Bearer mgmt-")) {
      return c.json({ error: { message: "management API key required", type: "unauthorized" } }, 401);
    }
    const key = auth.slice(7);
    const hash = hashApiKey(key);
    const [row] = await db.select().from(managementKeys).where(eq(managementKeys.keyHash, hash)).limit(1);
    if (!row || row.revokedAt) {
      return c.json({ error: { message: "invalid management key", type: "unauthorized" } }, 401);
    }
    const hasScope = requiredScopes.some(s => row.scopes.includes(s));
    if (!hasScope) {
      return c.json({ error: { message: "insufficient scope", type: "forbidden" } }, 403);
    }
    // fire-and-forget lastUsedAt update
    db.update(managementKeys).set({ lastUsedAt: new Date() }).where(eq(managementKeys.id, row.id)).catch(() => {});
    c.set("mgmtKey" as never, row as never);
    await next();
  };
}