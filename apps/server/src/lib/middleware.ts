import type { MiddlewareHandler } from "hono";
import type { RedisClient } from "./redis.js";

// ponytail: per-API-key sliding window rate limit. Default 100 req/min.
// No Redis = no rate limiting (Redis is ephemeral, loss is graceful).

const WINDOW_S = 60;
const DEFAULT_LIMIT = 100;

export function rateLimit(redis: RedisClient | null, limit = DEFAULT_LIMIT): MiddlewareHandler {
  return async (c, next) => {
    if (!redis) {
      await next();
      return;
    }
    const apiKeyId = c.get("apiKey")?.id;
    if (!apiKeyId) {
      await next();
      return;
    }
    const key = `rl:${apiKeyId}:${Math.floor(Date.now() / (WINDOW_S * 1000))}`;

    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_S);
    if (count > limit) {
      return c.json(
        { error: { message: `rate limit exceeded (${limit} req/${WINDOW_S}s)`, type: "rate_limit_error" } },
        429,
      );
    }
    c.header("x-ratelimit-limit", String(limit));
    c.header("x-ratelimit-remaining", String(Math.max(0, limit - count)));
    await next();
  };
}

// ── Per-IP rate limit for unauthenticated endpoints (login, setup, OAuth) ─
// Prevents brute-force + DoS on the unauthenticated bootstrap surface.
// ponytail: separate counter from per-key auth; much smaller limit.
export function ipRateLimit(redis: RedisClient | null, limit = 20, windowSec = 60): MiddlewareHandler {
  return async (c, next) => {
    if (!redis) {
      await next();
      return;
    }
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
    const key = `rlip:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    if (count > limit) {
      return c.json(
        { error: { message: `too many requests from this IP (${limit} req/${windowSec}s)`, type: "rate_limit_error" } },
        429,
      );
    }
    await next();
  };
}

// ── Body size limit (DoS protection against huge JSON bodies) ────────
// Reads Content-Length and rejects requests that declare too large a body.
// Hono's c.req.json() reads the entire body into memory — without this
// check, a 10GB POST would OOM the process before any handler ran.
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB for admin/auth endpoints
// Chat completions can carry long prompts — give them more room.
export const MAX_BODY_PROXY = 10 * 1024 * 1024; // 10 MiB for /v1/*

export function bodySizeLimit(maxBytes = DEFAULT_MAX_BODY_BYTES): MiddlewareHandler {
  return async (c, next) => {
    const len = c.req.header("content-length");
    if (len !== undefined) {
      const n = Number(len);
      if (Number.isFinite(n) && n > maxBytes) {
        return c.json(
          { error: { message: `request body too large (max ${maxBytes} bytes)`, type: "request_too_large" } },
          413,
        );
      }
    }
    await next();
  };
}

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    // ponytail: Cloudflare caches responses without explicit Cache-Control.
    // API responses must never be cached — they're dynamic. This prevents
    // stale {"providers":[]} from being served after data changes.
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'",
    );
    await next();
  };
}