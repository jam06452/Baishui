import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, and, sql } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { hashApiKey } from "../lib/api-key.js";
import { logger } from "../lib/logger.js";
import { selectKey, incrInflight, decrInflight, recordSuccess, recordError } from "../lib/key-health.js";
import { getAdapter, type StreamCtx } from "../lib/adapters/index.js";
import { cacheGetOrSet, authCacheKey, modelCacheKey } from "../lib/cache.js";
import { applyStrategy } from "../lib/load-balancing.js";
import {
  apiKeys, users, providers, providerKeys, models, routingRules,
  type ApiKeyRow, type User, type Provider, type ProviderKey, type Model,
} from "@baishui/db";

// ponytail: Node 20+ default fetch uses undici with keepAlive=true; no
// custom Agent needed. If we ever need to tune connections per host we can
// add `undici` and call setGlobalDispatcher(new Agent({...})) — but the
// default already handles thousands of concurrent upstream calls.

// ─── context types ──────────────────────────────────────────────
interface V1Vars {
  Variables: {
    apiKey: ApiKeyRow;
    user: User;
  };
}

interface ResolvedModel {
  model: Model;
  provider: Provider;
  providerKey: ProviderKey;
  decryptedSecret: string;
}

// Cached auth response — payload shape stored in Redis.
interface CachedAuth {
  apiKey: ApiKeyRow;
  user: Pick<User, "id" | "email" | "name" | "role" | "forcePasswordChange">;
}
interface ResolvedModelCache {
  model: Model;
  provider: Provider;
  keys: ProviderKey[];
}

// ─── auth middleware (cached) ───────────────────────────────────
async function authApiKey(
  rt: Runtime,
  header: string | undefined,
): Promise<{ apiKey: ApiKeyRow; user: User } | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice(7);
  const hash = hashApiKey(key);
  const cacheKey = authCacheKey(hash);

  const cached = await cacheGetOrSet<CachedAuth | null>(rt.redis, cacheKey, rt.config.CACHE_TTL_AUTH_S, async () => {
    const rows = await rt.db.db
      .select({ apiKey: apiKeys, user: users })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(and(eq(apiKeys.keyHash, hash)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.apiKey.revokedAt) return null;
    return {
      apiKey: row.apiKey,
      user: {
        id: row.user.id, email: row.user.email, name: row.user.name,
        role: row.user.role, forcePasswordChange: row.user.forcePasswordChange,
      },
    };
  });

  if (!cached) return null;
  // load full user from DB if needed — cached object only has minimal fields
  // but our middleware only uses id/email/role/forcePasswordChange, so cast it.
  return {
    apiKey: cached.apiKey,
    user: cached.user as unknown as User,
  };
}

// ─── model resolution (cached) ─────────────────────────────────
// ponytail: auto-fallback by model name. When a client requests "openai-gpt-5",
// we find ALL providers that have a model with that upstream_id, ordered by
// provider creation date (first created = tried first). The chat handler
// retries across candidates on upstream errors (403/429/5xx). Manual routes
// (the Routing page) take precedence — if a route alias matches, its chain
// is used instead.

interface ResolvedCandidate {
  model: Model;
  provider: Provider;
  providerKey: ProviderKey;
  decryptedSecret: string;
}

type ResolveResult =
  | { ok: true; candidates: ResolvedCandidate[] }
  | { ok: false; reason: "not_found" | "no_keys" | "all_cooldown" };

async function resolveModel(rt: Runtime, modelId: string): Promise<ResolveResult> {
  // 1. Check routing rules — alias → priority-ordered fallback chain
  const [rule] = await rt.db.db.select().from(routingRules).where(eq(routingRules.alias, modelId)).limit(1);
  if (rule && rule.enabled) {
    const chain = [rule.primaryModelId, ...(rule.fallbackChain ?? []).sort((a, b) => a.priority - b.priority).map((e) => e.modelId)];
    const candidates: ResolvedCandidate[] = [];
    let lastReason: "not_found" | "no_keys" | "all_cooldown" = "not_found";
    for (const mid of chain) {
      const r = await resolveByModelId(rt, mid);
      if (r.ok) candidates.push(...r.candidates);
      else lastReason = r.reason;
    }
    if (candidates.length > 0) return { ok: true, candidates };
    return { ok: false, reason: lastReason };
  }
  // 2. Try as a model UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(modelId)) {
    const r = await resolveByModelId(rt, modelId);
    if (r.ok) return r;
  }
  // 3. Try as upstreamId or displayName (e.g. "kimi-k2.6-normal") — auto-fallback
  // ponytail: match by upstreamId OR displayName so users can rename models to
  // canonical names that match across providers. upstreamId is what gets sent
  // to the upstream API; displayName is what clients request.
  // applyStrategy shuffles candidates for round_robin models.
  const matchingModels = await rt.db.db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(
      eq(models.enabled, true),
      eq(providers.enabled, true),
      sql`(${models.upstreamId} = ${modelId} OR ${models.displayName} = ${modelId})`,
    ))
    .orderBy(providers.createdAt);
  if (matchingModels.length === 0) return { ok: false, reason: "not_found" };
  const candidates: ResolvedCandidate[] = [];
  let lastReason: "not_found" | "no_keys" | "all_cooldown" = "not_found";
  for (const row of matchingModels) {
    const r = await resolveByModelId(rt, row.models.id);
    if (r.ok) candidates.push(...r.candidates);
    else lastReason = r.reason;
  }
  if (candidates.length > 0) {
    const shuffled = await applyStrategy(rt.redis, modelId, candidates);
    return { ok: true, candidates: shuffled };
  }
  return { ok: false, reason: lastReason };
}

async function resolveByModelId(rt: Runtime, modelId: string): Promise<ResolveResult> {
  const cacheKey = modelCacheKey(modelId);
  const cached = await cacheGetOrSet<ResolvedModelCache | null>(rt.redis, cacheKey, rt.config.CACHE_TTL_MODEL_S, async () => {
    const [model] = await rt.db.db.select().from(models).where(eq(models.id, modelId)).limit(1);
    if (!model || !model.enabled) return null;
    const [provider] = await rt.db.db.select().from(providers).where(eq(providers.id, model.providerId)).limit(1);
    if (!provider || !provider.enabled) return null;
    const keys = await rt.db.db
      .select().from(providerKeys)
      .where(and(eq(providerKeys.providerId, provider.id), eq(providerKeys.status, "active")));
    return { model, provider, keys };
  });
  if (!cached) return { ok: false, reason: "not_found" };
  if (cached.keys.length === 0) return { ok: false, reason: "no_keys" };
  const selected = await selectKey(rt.redis, cached.keys);
  if (!selected) return { ok: false, reason: "all_cooldown" };
  const decryptedSecret = rt.crypto.decrypt({ kid: selected.secretKid, ciphertext: selected.secretEnc });
  return { ok: true, candidates: [{ model: cached.model, provider: cached.provider, providerKey: selected, decryptedSecret }] };
}

// ─── usage logging (batched, fire-and-forget) ───────────────────
function logUsage(rt: Runtime, params: {
  userId: string; apiKeyId: string; providerId: string; providerKeyId: string;
  modelId: string; status: number; latencyMs: number; inputTokens: number; outputTokens: number;
  stream: boolean; errorCode?: string; errorMsg?: string; servedByModelId?: string;
  inputPricePer1m?: string | null; outputPricePer1m?: string | null;
}) {
  // ponytail: compute cost from model pricing. Prices are per 1M tokens.
  // If prices are null/missing, cost = null (unknown, not zero).
  let costEstimate: string | null = null;
  if (params.inputPricePer1m && params.outputPricePer1m) {
    const inp = Number(params.inputPricePer1m);
    const out = Number(params.outputPricePer1m);
    if (Number.isFinite(inp) && Number.isFinite(out)) {
      const cost = (params.inputTokens * inp + params.outputTokens * out) / 1_000_000;
      costEstimate = cost.toFixed(6);
    }
  }
  rt.usage.append({
    userId: params.userId,
    providerId: params.providerId,
    providerKeyId: params.providerKeyId,
    modelId: params.modelId,
    apiKeyId: params.apiKeyId,
    servedByModelId: params.servedByModelId ?? null,
    status: params.status,
    latencyMs: params.latencyMs,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costEstimate,
    errorCode: params.errorCode ?? null,
    errorMsg: params.errorMsg ?? null,
    stream: params.stream,
  });
}

// ponytail: sanitize upstream error text before returning to client. Upstream
// errors may include request IDs, internal auth metadata, or partial PII —
// we log the raw text in the DB (request_logs.error_msg) for admins but only
// return a short, safe summary to the API client.
function safeUpstreamError(status: number): { message: string; type: string } {
  if (status === 401 || status === 403) return { message: "upstream authentication failed", type: "upstream_auth_error" };
  if (status === 429) return { message: "upstream rate limited", type: "rate_limit_error" };
  if (status >= 500) return { message: "upstream provider error", type: "upstream_error" };
  if (status === 400) return { message: "invalid request to upstream", type: "invalid_request_error" };
  return { message: `upstream returned ${status}`, type: "upstream_error" };
}

export function v1Routes(rt: Runtime): Hono<V1Vars> {
  const app = new Hono<V1Vars>();

  // ── API key auth middleware ─────────────────────────────────
  app.use("*", async (c, next) => {
    const authed = await authApiKey(rt, c.req.header("authorization"));
    if (!authed) {
      return c.json({ error: { message: "invalid API key", type: "invalid_request_error" } }, 401);
    }
    c.set("apiKey", authed.apiKey);
    c.set("user", authed.user);
    // ponytail: dropped per-request lastUsedAt update. Worker computes it
    // from request_logs aggregation; updating per-request was a DB write
    // on the hot path that nobody needed.
    await next();
  });

  // ── GET /v1/models ──────────────────────────────────────────
  app.get("/models", async (c) => {
    // Cache /v1/models too — admin mutations are rare, the model list
    // doesn't change between them.
    const cacheKey = "v1:models";
    const cached = await cacheGetOrSet(rt.redis, cacheKey, rt.config.CACHE_TTL_MODEL_S, async () => {
      const rows = await rt.db.db
        .select({ id: models.upstreamId, displayName: models.displayName, contextWindow: models.contextWindow })
        .from(models)
        .innerJoin(providers, eq(models.providerId, providers.id))
        .where(and(eq(models.enabled, true), eq(providers.enabled, true)))
        .orderBy(models.displayName);
      return rows.map((m) => ({
        id: m.id, object: "model", created: 0, owned_by: "baishui",
        display_name: m.displayName, context_window: m.contextWindow,
      }));
    });
    return c.json({ object: "list", data: cached });
  });

  // ── POST /v1/chat/completions ───────────────────────────────
  // ponytail: auto-fallback — try each candidate provider in order. If the
  // upstream returns a retryable error (403/404/429/5xx), record the error
  // and try the next candidate. Only return an error to the client if ALL
  // candidates fail. Once streaming starts (first byte), we're committed.
  app.post("/chat/completions", async (c) => {
    const start = Date.now();
    const body = await c.req.json().catch(() => null);
    if (!body?.model) {
      return c.json({ error: { message: "model required", type: "invalid_request_error" } }, 400);
    }
    const resolved = await resolveModel(rt, body.model);
    if (!resolved.ok) {
      const messages: Record<string, string> = {
        not_found: "model not found or unavailable",
        no_keys: "model found but provider has no active API keys — add a key in the dashboard",
        all_cooldown: "all provider keys are rate-limited or in cooldown — try again shortly",
      };
      const status = resolved.reason === "not_found" ? 404 : 503;
      return c.json({ error: { message: messages[resolved.reason], type: resolved.reason === "not_found" ? "invalid_request_error" : "server_error" } }, status as 404 | 503);
    }

    const isStream = body.stream === true;
    const userId = c.get("user").id;
    const apiKeyId = c.get("apiKey").id;
    let lastError: { status: number; message: string; type: string } = { status: 502, message: "upstream unreachable", type: "server_error" };

    for (let i = 0; i < resolved.candidates.length; i++) {
      const { model, provider, providerKey, decryptedSecret } = resolved.candidates[i]!;
      const keyId = providerKey.id;
      const adapter = getAdapter(provider.type);
      const upstreamCall = adapter.buildCall(body, model, provider, decryptedSecret);
      const isLast = i === resolved.candidates.length - 1;

      await incrInflight(rt.redis, keyId);

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(upstreamCall.url, {
          method: upstreamCall.method,
          headers: upstreamCall.headers,
          body: JSON.stringify(upstreamCall.body),
          signal: AbortSignal.timeout(120000),
        });
      } catch (err) {
        await decrInflight(rt.redis, keyId);
        await recordError(rt.redis, keyId, 503);
        logUsage(rt, { userId, apiKeyId, providerId: provider.id, providerKeyId: providerKey.id, modelId: model.id, status: 502, latencyMs: Date.now() - start, inputTokens: 0, outputTokens: 0, stream: isStream, errorCode: "upstream_unreachable", errorMsg: (err as Error).message, inputPricePer1m: model.inputPricePer1m, outputPricePer1m: model.outputPricePer1m });
        lastError = { status: 502, message: "upstream unreachable", type: "server_error" };
        if (!isLast) continue;
        return c.json({ error: { message: lastError.message, type: lastError.type } }, 502);
      }

      if (upstreamRes.ok) { await recordSuccess(rt.redis, keyId); }
      else { const ra = upstreamRes.headers.get("retry-after"); await recordError(rt.redis, keyId, upstreamRes.status, ra ? Number(ra) * 1000 : undefined); }

      // Non-streaming
      if (!isStream) {
        const text = await upstreamRes.text();
        const latencyMs = Date.now() - start;
        if (!upstreamRes.ok) {
          await decrInflight(rt.redis, keyId);
          logUsage(rt, { userId, apiKeyId, providerId: provider.id, providerKeyId: providerKey.id, modelId: model.id, status: upstreamRes.status, latencyMs, inputTokens: 0, outputTokens: 0, stream: false, errorCode: String(upstreamRes.status), errorMsg: text.slice(0, 500), inputPricePer1m: model.inputPricePer1m, outputPricePer1m: model.outputPricePer1m });
          const safe = safeUpstreamError(upstreamRes.status);
          lastError = { status: upstreamRes.status, message: safe.message, type: safe.type };
          if (!isLast && (upstreamRes.status === 403 || upstreamRes.status === 404 || upstreamRes.status === 429 || upstreamRes.status >= 500)) continue;
          return c.json({ error: { message: lastError.message, type: lastError.type } }, upstreamRes.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503);
        }
        const { body: normalized, usage } = adapter.normalizeResponse(text);
        await decrInflight(rt.redis, keyId);
        logUsage(rt, { userId, apiKeyId, providerId: provider.id, providerKeyId: providerKey.id, modelId: model.id, status: 200, latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, stream: false, servedByModelId: model.id, inputPricePer1m: model.inputPricePer1m, outputPricePer1m: model.outputPricePer1m });
        return new Response(JSON.stringify(normalized), { status: 200, headers: { "content-type": "application/json", "x-or-served-by": `${provider.name}/${model.upstreamId}` } });
      }

      // Streaming
      if (!upstreamRes.ok || !upstreamRes.body) {
        const text = await upstreamRes.text().catch(() => "");
        await decrInflight(rt.redis, keyId);
        logUsage(rt, { userId, apiKeyId, providerId: provider.id, providerKeyId: providerKey.id, modelId: model.id, status: upstreamRes.status, latencyMs: Date.now() - start, inputTokens: 0, outputTokens: 0, stream: true, errorCode: String(upstreamRes.status), errorMsg: text.slice(0, 500), inputPricePer1m: model.inputPricePer1m, outputPricePer1m: model.outputPricePer1m });
        const safe = safeUpstreamError(upstreamRes.status);
        lastError = { status: upstreamRes.status, message: safe.message, type: safe.type };
        if (!isLast && (upstreamRes.status === 403 || upstreamRes.status === 404 || upstreamRes.status === 429 || upstreamRes.status >= 500)) continue;
        return c.json({ error: { message: lastError.message, type: lastError.type } }, upstreamRes.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503);
      }

      // Stream is OK — commit to this candidate
      let inputTokens = 0, outputTokens = 0;
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      const ctx: StreamCtx = { started: false, model: model.upstreamId, created: Math.floor(Date.now() / 1000), modelId: model.id };

      return streamSSE(c, async (stream) => {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              const { outputs, finalUsage, done: streamDone } = adapter.normalizeStreamChunk(data, ctx);
              if (finalUsage) { inputTokens = finalUsage.inputTokens || inputTokens; outputTokens = finalUsage.outputTokens || outputTokens; }
              for (const out of outputs) { await stream.writeSSE({ data: out }); }
              if (streamDone) { await stream.writeSSE({ data: "[DONE]" }); }
            }
          }
        } finally {
          await decrInflight(rt.redis, keyId);
          logUsage(rt, { userId, apiKeyId, providerId: provider.id, providerKeyId: providerKey.id, modelId: model.id, status: 200, latencyMs: Date.now() - start, inputTokens, outputTokens, stream: true, servedByModelId: model.id, inputPricePer1m: model.inputPricePer1m, outputPricePer1m: model.outputPricePer1m });
        }
      });
    }

    // All candidates failed
    return c.json({ error: { message: lastError.message, type: lastError.type } }, lastError.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503);
  });

  return app;
}
