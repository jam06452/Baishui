import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import type { Runtime } from "../lib/runtime.js";
import type { AppConfig } from "../lib/config.js";
import { isGitHubOAuthEnabled, parseAllowedEmailDomains } from "../lib/config.js";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  setPkceCookie,
  getPkceCookie,
  clearPkceCookie,
  generatePkce,
  generateState,
  isEmailAllowed,
  requireRole,
  type AppVars,
} from "../lib/auth.js";
import { users, oauthAccounts, auditLog } from "@baishui/db";

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  emails: { email: string; primary: boolean; verified: boolean }[];
}

function buildGithubAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read:user user:email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function exchangeGithubCode(
  code: string,
  verifier: string,
  config: AppConfig,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: config.GITHUB_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(body.error ?? "no access token");
  return body.access_token;
}

async function fetchGithubUser(token: string): Promise<GithubUser> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userRes.ok) throw new Error(`github user fetch failed: ${userRes.status}`);
  const user = (await userRes.json()) as Omit<GithubUser, "emails">;
  const emails = emailsRes.ok ? ((await emailsRes.json()) as GithubUser["emails"]) : [];
  return { ...user, emails };
}

function getVerifiedPrimaryEmail(gu: GithubUser): string | null {
  const primary = gu.emails.find((e) => e.primary && e.verified);
  return primary?.email ?? (gu.email && gu.emails.some((e) => e.email === gu.email && e.verified) ? gu.email : null);
}

async function writeAudit(
  rt: Runtime,
  actorUserId: string | null,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: unknown,
): Promise<void> {
  await rt.db.db.insert(auditLog).values({
    actorUserId,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    meta: meta ?? null,
  });
}

export function authRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();

  // ── Password login ──────────────────────────────────────────
  app.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return c.json({ error: { message: "email and password required", type: "bad_request" } }, 400);
    }
    const [user] = await rt.db.db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!user || !user.passwordHash) {
      return c.json({ error: { message: "invalid credentials", type: "invalid_credentials" } }, 401);
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return c.json({ error: { message: "invalid credentials", type: "invalid_credentials" } }, 401);
    }
    const { token } = await createSession(rt.db.db, user.id, {
      ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? undefined,
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    setSessionCookie(c, token);
    await rt.db.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await writeAudit(rt, user.id, "user.login", "user", user.id);
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, forcePasswordChange: user.forcePasswordChange } });
  });

  // ── Logout ──────────────────────────────────────────────────
  app.post("/logout", async (c) => {
    const cookie = getCookie(c, "baishui_session");
    if (cookie) {
      await destroySession(rt.db.db, cookie);
      await writeAudit(rt, null, "user.logout");
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // ── Current user ────────────────────────────────────────────
  app.get("/me", requireRole(rt.db.db, "member", "admin", "owner"), async (c) => {
    const user = c.get("user");
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, forcePasswordChange: user.forcePasswordChange } });
  });

  // ── Change password ─────────────────────────────────────────
  app.post("/change-password", requireRole(rt.db.db, "member", "admin", "owner"), async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    if (!body?.newPassword || typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return c.json({ error: { message: "newPassword (min 8 chars) required", type: "bad_request" } }, 400);
    }
    const [row] = await rt.db.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row) return c.json({ error: { message: "user not found", type: "not_found" } }, 404);

    if (row.passwordHash) {
      if (!body.oldPassword) {
        return c.json({ error: { message: "oldPassword required", type: "bad_request" } }, 400);
      }
      const ok = await verifyPassword(body.oldPassword, row.passwordHash);
      if (!ok) return c.json({ error: { message: "old password incorrect", type: "invalid_credentials" } }, 401);
    }

    const newHash = await hashPassword(body.newPassword);
    await rt.db.db
      .update(users)
      .set({ passwordHash: newHash, forcePasswordChange: false })
      .where(eq(users.id, user.id));
    await writeAudit(rt, user.id, "user.change_password", "user", user.id);
    return c.json({ ok: true });
  });

  // ── GitHub OAuth: initiate ──────────────────────────────────
  app.get("/github", (c) => {
    if (!isGitHubOAuthEnabled(rt.config)) {
      return c.json({ error: { message: "GitHub OAuth not configured", type: "not_configured" } }, 503);
    }
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    setPkceCookie(c, `${state}:${verifier}`);
    const url = buildGithubAuthorizeUrl(
      rt.config.GITHUB_CLIENT_ID,
      rt.config.GITHUB_REDIRECT_URI,
      state,
      challenge,
    );
    return c.redirect(url);
  });

  // ── GitHub OAuth: callback ──────────────────────────────────
  app.get("/callback/github", async (c) => {
    if (!isGitHubOAuthEnabled(rt.config)) {
      return c.json({ error: { message: "GitHub OAuth not configured", type: "not_configured" } }, 503);
    }
    const code = c.req.query("code");
    const state = c.req.query("state");
    const pkce = getPkceCookie(c);
    clearPkceCookie(c);

    if (!code || !state || !pkce) {
      return c.json({ error: { message: "missing OAuth parameters", type: "bad_request" } }, 400);
    }
    const [storedState, verifier] = pkce.split(":");
    if (state !== storedState || !verifier) {
      return c.json({ error: { message: "state mismatch", type: "bad_request" } }, 400);
    }

    let ghUser: GithubUser;
    try {
      const accessToken = await exchangeGithubCode(code, verifier, rt.config);
      ghUser = await fetchGithubUser(accessToken);
    } catch (err) {
      return c.json({ error: { message: "OAuth exchange failed", type: "oauth_error" } }, 502);
    }

    const email = getVerifiedPrimaryEmail(ghUser);
    if (!email) {
      return c.json({ error: { message: "no verified primary email on GitHub account", type: "oauth_error" } }, 400);
    }

    const allowedDomains = parseAllowedEmailDomains(rt.config);
    if (!isEmailAllowed(email, allowedDomains)) {
      return c.json({ error: { message: `email domain not allowed: ${email.split("@")[1]}`, type: "forbidden" } }, 403);
    }

    // Find or auto-create user
    const [existing] = await rt.db.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    let user = existing;
    if (!user) {
      const [created] = await rt.db.db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          name: ghUser.name ?? ghUser.login,
          role: "member",
          emailVerifiedAt: new Date(),
        })
        .returning();
      user = created!;
      await writeAudit(rt, user.id, "user.oauth_create", "user", user.id, { provider: "github", githubLogin: ghUser.login });
    }

    // Upsert OAuth account link — ponytail: not storing GitHub tokens; only
    // needed if we do GitHub API ops on behalf of the user later.
    await rt.db.db
      .insert(oauthAccounts)
      .values({
        userId: user.id,
        provider: "github",
        providerUserId: String(ghUser.id),
      })
      .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerUserId] });

    const { token } = await createSession(rt.db.db, user.id, {
      ip: c.req.header("x-forwarded-for") ?? undefined,
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    setSessionCookie(c, token);
    await rt.db.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await writeAudit(rt, user.id, "user.login", "user", user.id, { via: "github" });
    // ponytail: redirect to root — the SPA router picks the right view.
    return c.redirect("/");
  });

  // ── Link GitHub to existing account ─────────────────────────
  app.post("/link/github", requireRole(rt.db.db, "member", "admin", "owner"), async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    if (!body?.githubUserId || !body?.githubLogin) {
      return c.json({ error: { message: "githubUserId and githubLogin required", type: "bad_request" } }, 400);
    }
    await rt.db.db
      .insert(oauthAccounts)
      .values({
        userId: user.id,
        provider: "github",
        providerUserId: String(body.githubUserId),
      })
      .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerUserId] });
    await writeAudit(rt, user.id, "user.link_oauth", "user", user.id, { provider: "github", login: body.githubLogin });
    return c.json({ ok: true });
  });

  app.delete("/link/github", requireRole(rt.db.db, "member", "admin", "owner"), async (c) => {
    const user = c.get("user");
    await rt.db.db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, user.id), eq(oauthAccounts.provider, "github")));
    await writeAudit(rt, user.id, "user.unlink_oauth", "user", user.id, { provider: "github" });
    return c.json({ ok: true });
  });

  return app;
}