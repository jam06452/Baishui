import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "../lib/logger.js";
import type { Runtime } from "../lib/runtime.js";
import { healthRoutes } from "../routes/health.js";
import { homeRoutes } from "../routes/home.js";
import { authRoutes } from "../routes/auth.js";
import { userRoutes } from "../routes/users.js";
import { auditRoutes } from "../routes/audit.js";
import { providerRoutes } from "../routes/providers.js";
import { apiKeyRoutes } from "../routes/api-keys.js";
import { analyticsRoutes } from "../routes/analytics.js";
import { requestRoutes } from "../routes/requests.js";
import { routingCrudRoutes } from "../routes/routing.js";
import { loadBalancingRoutes } from "../routes/load-balancing.js";
import { setupRoutes } from "../routes/setup.js";
import { v1Routes } from "../routes/v1.js";
import { csrfMiddleware } from "../lib/auth.js";
import { rateLimit, securityHeaders, bodySizeLimit, ipRateLimit, MAX_BODY_PROXY } from "../lib/middleware.js";

export async function runProxy(rt: Runtime): Promise<void> {
  const app = new Hono();

  app.use("*", securityHeaders());
  app.route("/", healthRoutes(rt));
  app.route("/", homeRoutes());

  // Setup wizard — IP-rate-limited (no auth: blocks brute force on first-user
  // creation). Self-locks once the first owner exists. ponytail: CSRF not
  // needed — setup only succeeds when zero users exist, so a CSRF attack
  // that triggers /api/setup only succeeds in creating the first user — which
  // is the legitimate state anyway. Cyclomatic equivalence with no-CSRF-of-value.
  app.use("/api/setup/*", ipRateLimit(rt.redis, 20, 60));
  app.use("/api/setup/*", bodySizeLimit(4 * 1024)); // tiny: email + password only
  app.route("/api/setup", setupRoutes(rt));

  // Auth endpoints — stricter IP rate limit (brute-force protection for
  // login). Body size limited to login form size.
  app.use("/api/auth/login", ipRateLimit(rt.redis, 30, 60));
  app.use("/api/auth/login", bodySizeLimit(1024));
  app.use("/api/auth/change-password", bodySizeLimit(1024));
  app.use("/api/auth/link/github", bodySizeLimit(1024));

  // CSRF protection on all /api mutations
  app.use("/api/*", csrfMiddleware());

  // ponytail: cap body size on admin endpoints (1 MiB is plenty for user
  // records, provider metadata, model configs).
  app.use("/api/*", bodySizeLimit());

  app.route("/api/auth", authRoutes(rt));
  app.route("/api/users", userRoutes(rt));
  app.route("/api/audit", auditRoutes(rt));
  app.route("/api/providers", providerRoutes(rt));
  app.route("/api/keys", apiKeyRoutes(rt));
  app.route("/api/analytics", analyticsRoutes(rt));
  app.route("/api/requests", requestRoutes(rt));
  app.route("/api/routes", routingCrudRoutes(rt));
  app.route("/api/loadbalancing", loadBalancingRoutes(rt));

  // /v1: larger body limit (chat prompts can be chunky), then rate limit per
  // API key, then the proxy routes.
  app.use("/v1/*", bodySizeLimit(MAX_BODY_PROXY));
  app.use("/v1/*", rateLimit(rt.redis));
  app.route("/v1", v1Routes(rt));

  app.notFound((c) => c.json({ error: { message: "not found", type: "not_found" } }, 404));
  app.onError((err, c) => {
    logger.error({ err }, "unhandled error");
    return c.json({ error: { message: "internal error", type: "internal_error" } }, 500);
  });

  logger.info({ port: rt.config.PORT, role: "proxy" }, "starting proxy server");
  await serve(
    { fetch: app.fetch, port: rt.config.PORT, hostname: "0.0.0.0" },
    (info) => logger.info({ address: info.address, port: info.port }, "proxy listening"),
  );
}