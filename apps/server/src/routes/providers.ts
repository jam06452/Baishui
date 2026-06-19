import { Hono } from "hono";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { getKeyHealth } from "../lib/key-health.js";
import { extractPricing, extractContextWindow } from "../lib/pricing-table.js";
import { deleteAllModelsByPattern } from "../lib/cache.js";
import { providers, providerKeys, models, auditLog } from "@baishui/db";
import type { Provider, ProviderKey } from "@baishui/db";

// ponytail: OpenAI-compatible model list shape (the only shape most providers use).
interface UpstreamModel {
  id: string;
  owned_by?: string;
  context_window?: number;
}

async function fetchUpstreamModels(baseUrl: string, apiKey: string): Promise<UpstreamModel[]> {
  // ponytail: handle both baseUrl styles: "https://host" and "https://host/v1".
  // Users enter either; appending /v1/models blindly produces /v1/v1/models.
  const base = baseUrl.replace(/\/$/, "");
  const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data?: UpstreamModel[] };
  return body.data ?? [];
}

async function decryptKeySecret(rt: Runtime, pk: ProviderKey): Promise<string> {
  const sealed = { kid: pk.secretKid, ciphertext: pk.secretEnc };
  return rt.crypto.decrypt(sealed);
}

async function writeAudit(rt: Runtime, actor: string, action: string, target?: string, id?: string, meta?: unknown) {
  await rt.db.db.insert(auditLog).values({
    actorUserId: actor, action, targetType: target ?? null, targetId: id ?? null, meta: meta ?? null,
  });
}

/** Invalidate all model cache entries + the /v1/models list. Called after any
 *  provider/key/model mutation. ponytail: whole-pattern flush because one
 *  model mutation can affect routing chains and the listings cache. */
async function invalidateModelCache(rt: Runtime): Promise<void> {
  await deleteAllModelsByPattern(rt.redis);
}

export function providerRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "admin"));

  // ── Providers ───────────────────────────────────────────────
  app.get("/", async (c) => {
    const rows = await rt.db.db.select().from(providers).orderBy(providers.createdAt);
    return c.json({ providers: rows });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.name || !body?.type) {
      return c.json({ error: { message: "name and type required", type: "bad_request" } }, 400);
    }
    // ponytail: validate type against the enum — bad type would cause a PG 500.
    const VALID_TYPES = ["openai_compatible","openai","anthropic","google","mistral","together","groq","fireworks","deepseek","azure_openai","cohere","bedrock","custom"];
    if (!VALID_TYPES.includes(body.type)) {
      return c.json({ error: { message: "invalid provider type", type: "bad_request" } }, 400);
    }
    const [created] = await rt.db.db
      .insert(providers)
      .values({
        name: body.name,
        type: body.type,
        baseUrl: body.baseUrl ?? null,
        adapter: body.adapter ?? body.type,
        enabled: body.enabled ?? true,
        createdBy: c.get("user").id,
      })
      .returning();
    await writeAudit(rt, c.get("user").id, "provider.create", "provider", created!.id, { name: body.name, type: body.type });
    await invalidateModelCache(rt);
    return c.json({ provider: created }, 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: { message: "body required", type: "bad_request" } }, 400);
    const updates: Partial<typeof providers.$inferInsert> = {};
    for (const k of ["name", "type", "baseUrl", "adapter", "enabled"] as const) {
      if (body[k] !== undefined) (updates as Record<string, unknown>)[k] = body[k];
    }
    if (Object.keys(updates).length === 0) return c.json({ error: { message: "no fields to update", type: "bad_request" } }, 400);
    const [updated] = await rt.db.db.update(providers).set(updates).where(eq(providers.id, id)).returning();
    if (!updated) return c.json({ error: { message: "provider not found", type: "not_found" } }, 404);
    await writeAudit(rt, c.get("user").id, "provider.update", "provider", id, updates);
    await invalidateModelCache(rt);
    return c.json({ provider: updated });
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [deleted] = await rt.db.db.delete(providers).where(eq(providers.id, id)).returning({ id: providers.id });
    if (!deleted) return c.json({ error: { message: "provider not found", type: "not_found" } }, 404);
    await writeAudit(rt, c.get("user").id, "provider.delete", "provider", id);
    await invalidateModelCache(rt);
    return c.json({ ok: true });
  });

  // ── Provider keys (encrypted) ───────────────────────────────
  app.get("/:id/keys", async (c) => {
    const id = c.req.param("id");
    const rows = await rt.db.db
      .select({
        id: providerKeys.id, providerId: providerKeys.providerId, label: providerKeys.label,
        status: providerKeys.status, dailyQuotaUsd: providerKeys.dailyQuotaUsd,
        addedAt: providerKeys.addedAt, lastRotatedAt: providerKeys.lastRotatedAt,
        secretKid: providerKeys.secretKid,
      })
      .from(providerKeys)
      .where(eq(providerKeys.providerId, id))
      .orderBy(providerKeys.addedAt);
    return c.json({ keys: rows });
  });

  app.post("/:id/keys", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.secret) return c.json({ error: { message: "secret required", type: "bad_request" } }, 400);
    const [provider] = await rt.db.db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider) return c.json({ error: { message: "provider not found", type: "not_found" } }, 404);

    const sealed = rt.crypto.encrypt(body.secret);
    const [created] = await rt.db.db
      .insert(providerKeys)
      .values({
        providerId: id,
        label: body.label ?? "default",
        secretEnc: sealed.ciphertext,
        secretKid: sealed.kid,
        status: "active",
        dailyQuotaUsd: body.dailyQuotaUsd ?? null,
      })
      .returning();
    await writeAudit(rt, c.get("user").id, "provider_key.create", "provider_key", created!.id, { providerId: id, label: created!.label });
    await invalidateModelCache(rt);
    return c.json({ key: { id: created!.id, label: created!.label, status: created!.status } }, 201);
  });

  app.delete("/:id/keys/:keyId", async (c) => {
    const id = c.req.param("id");
    const keyId = c.req.param("keyId");
    const [deleted] = await rt.db.db
      .delete(providerKeys)
      .where(and(eq(providerKeys.id, keyId), eq(providerKeys.providerId, id)))
      .returning({ id: providerKeys.id });
    if (!deleted) return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
    await writeAudit(rt, c.get("user").id, "provider_key.delete", "provider_key", keyId, { providerId: id });
    await invalidateModelCache(rt);
    return c.json({ ok: true });
  });

  // ── Model sync (synchronous — ponytail: no queue for a list call) ──
  app.post("/:id/sync", async (c) => {
    const id = c.req.param("id");
    const [provider] = await rt.db.db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider) return c.json({ error: { message: "provider not found", type: "not_found" } }, 404);
    if (!provider.baseUrl) return c.json({ error: { message: "provider has no baseUrl", type: "bad_request" } }, 400);

    const keys = await rt.db.db.select().from(providerKeys).where(eq(providerKeys.providerId, id)).limit(1);
    if (keys.length === 0) return c.json({ error: { message: "no keys for provider", type: "bad_request" } }, 400);

    const apiKey = await decryptKeySecret(rt, keys[0]!);
    let upstreamModels: UpstreamModel[];
    try {
      upstreamModels = await fetchUpstreamModels(provider.baseUrl, apiKey);
    } catch (err) {
      // ponytail: never leak upstream response to client — may contain auth metadata.
      logger.warn({ err }, "model sync failed");
      return c.json({ error: { message: `sync failed: ${(err as Error).message}`, type: "upstream_error" } }, 502);
    }

    const now = new Date();
    let added = 0, updated = 0;
    for (const um of upstreamModels) {
      const umRecord = um as unknown as Record<string, unknown>;
      const { input, output } = extractPricing(umRecord);
      const ctx = extractContextWindow(umRecord);
      const [existing] = await rt.db.db
        .select().from(models)
        .where(and(eq(models.providerId, id), eq(models.upstreamId, um.id)))
        .limit(1);
      if (existing) {
        await rt.db.db.update(models)
          .set({
            displayName: um.id, lastSyncedAt: now,
            raw: um as unknown as Record<string, unknown>,
            inputPricePer1m: input, outputPricePer1m: output,
            contextWindow: ctx,
          })
          .where(eq(models.id, existing.id));
        updated++;
      } else {
        await rt.db.db.insert(models).values({
          providerId: id, upstreamId: um.id, displayName: um.id,
          contextWindow: ctx,
          inputPricePer1m: input, outputPricePer1m: output,
          lastSyncedAt: now, raw: um as unknown as Record<string, unknown>,
        });
        added++;
      }
    }
    await writeAudit(rt, c.get("user").id, "provider.sync", "provider", id, { added, updated, total: upstreamModels.length });
    await invalidateModelCache(rt);
    return c.json({ sync: { added, updated, total: upstreamModels.length } });
  });

  // ── List models for a provider ──────────────────────────────
  app.get("/:id/models", async (c) => {
    const id = c.req.param("id");
    const rows = await rt.db.db
      .select({
        id: models.id, upstreamId: models.upstreamId, displayName: models.displayName,
        contextWindow: models.contextWindow, enabled: models.enabled,
        inputPricePer1m: models.inputPricePer1m, outputPricePer1m: models.outputPricePer1m,
        modalities: models.modalities, compatTags: models.compatTags, lastSyncedAt: models.lastSyncedAt,
      })
      .from(models)
      .where(eq(models.providerId, id))
      .orderBy(models.displayName);
    return c.json({ models: rows });
  });

  app.patch("/:id/models/:modelId", async (c) => {
    const modelId = c.req.param("modelId");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: { message: "body required", type: "bad_request" } }, 400);
    const updates: Partial<typeof models.$inferInsert> = {};
    for (const k of ["displayName", "enabled", "inputPricePer1m", "outputPricePer1m", "compatTags", "modalities"] as const) {
      if (body[k] !== undefined) (updates as Record<string, unknown>)[k] = body[k];
    }
    const [updated] = await rt.db.db.update(models).set(updates).where(eq(models.id, modelId)).returning();
    if (!updated) return c.json({ error: { message: "model not found", type: "not_found" } }, 404);
    await invalidateModelCache(rt);
    return c.json({ model: updated });
  });

  // ── Bulk enable/disable models ─────────────────────────────
  app.patch("/:id/models/bulk/enabled", async (c) => {
    const providerId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.modelIds) || typeof body.enabled !== "boolean") {
      return c.json({ error: { message: "modelIds (array) and enabled (boolean) required", type: "bad_request" } }, 400);
    }
    if (body.modelIds.length === 0) {
      return c.json({ updated: 0 });
    }
    const result = await rt.db.db
      .update(models)
      .set({ enabled: body.enabled })
      .where(and(inArray(models.id, body.modelIds), eq(models.providerId, providerId)))
      .returning({ id: models.id });
    await invalidateModelCache(rt);
    return c.json({ updated: result.length });
  });

  // ── Export provider settings (models, enabled state, prices) ──
  // ponytail: JSON export like OpenWebUI. Includes provider info + all models
  // with their enabled/displayName/price state. Secrets are NEVER exported.
  app.get("/export/all", async (c) => {
    const allProviders = await rt.db.db.select().from(providers).orderBy(providers.createdAt);
    const exportData = await Promise.all(allProviders.map(async (p) => {
      const modelRows = await rt.db.db
        .select({
          upstreamId: models.upstreamId, displayName: models.displayName,
          enabled: models.enabled, contextWindow: models.contextWindow,
          inputPricePer1m: models.inputPricePer1m, outputPricePer1m: models.outputPricePer1m,
          modalities: models.modalities, compatTags: models.compatTags,
        })
        .from(models)
        .where(eq(models.providerId, p.id))
        .orderBy(models.displayName);
      return {
        name: p.name,
        type: p.type,
        baseUrl: p.baseUrl,
        adapter: p.adapter,
        enabled: p.enabled,
        models: modelRows,
      };
    }));
    c.header("Content-Disposition", 'attachment; filename="baishui-providers.json"');
    return c.json({ version: 1, exportedAt: new Date().toISOString(), providers: exportData });
  });

  // ── Import provider settings from JSON ────────────────────
  // ponytail: upserts providers + models from an exported file. Does NOT
  // import secrets (keys must be added manually after import). Existing
  // providers matched by name are updated; new ones are created.
  app.post("/import/all", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.providers || !Array.isArray(body.providers)) {
      return c.json({ error: { message: "Invalid import file — expected { providers: [...] }", type: "bad_request" } }, 400);
    }
    let providersAdded = 0, providersUpdated = 0, modelsAdded = 0, modelsUpdated = 0;
    for (const imp of body.providers) {
      if (!imp.name || !imp.type) continue;
      // Find existing by name
      const [existing] = await rt.db.db.select().from(providers).where(eq(providers.name, imp.name)).limit(1);
      let providerId: string;
      if (existing) {
        await rt.db.db.update(providers).set({
          type: imp.type, baseUrl: imp.baseUrl, adapter: imp.adapter,
          enabled: imp.enabled ?? true,
        }).where(eq(providers.id, existing.id));
        providerId = existing.id;
        providersUpdated++;
      } else {
        const [created] = await rt.db.db.insert(providers).values({
          name: imp.name, type: imp.type, baseUrl: imp.baseUrl,
          adapter: imp.adapter ?? imp.type, enabled: imp.enabled ?? true,
          createdBy: c.get("user").id,
        }).returning();
        providerId = created!.id;
        providersAdded++;
      }
      // Upsert models
      if (Array.isArray(imp.models)) {
        for (const m of imp.models) {
          if (!m.upstreamId) continue;
          const [existingModel] = await rt.db.db
            .select().from(models)
            .where(and(eq(models.providerId, providerId), eq(models.upstreamId, m.upstreamId)))
            .limit(1);
          if (existingModel) {
            await rt.db.db.update(models).set({
              displayName: m.displayName, enabled: m.enabled,
              inputPricePer1m: m.inputPricePer1m, outputPricePer1m: m.outputPricePer1m,
              contextWindow: m.contextWindow, modalities: m.modalities, compatTags: m.compatTags,
            }).where(eq(models.id, existingModel.id));
            modelsUpdated++;
          } else {
            await rt.db.db.insert(models).values({
              providerId, upstreamId: m.upstreamId, displayName: m.displayName ?? m.upstreamId,
              enabled: m.enabled ?? true, contextWindow: m.contextWindow,
              inputPricePer1m: m.inputPricePer1m, outputPricePer1m: m.outputPricePer1m,
              modalities: m.modalities, compatTags: m.compatTags,
            });
            modelsAdded++;
          }
        }
      }
    }
    await invalidateModelCache(rt);
    // ponytail: auto-fetch pricing from upstream for each provider that has keys.
    // Also applies built-in table for providers without pricing in their API.
    let pricesFound = 0, pricesFromAPI = 0, pricesFromTable = 0, pricesUnknown = 0;
    for (const imp of body.providers) {
      if (!imp.name || !imp.type) continue;
      const [p] = await rt.db.db.select().from(providers).where(eq(providers.name, imp.name)).limit(1);
      if (!p || !p.baseUrl) continue;
      // Try fetching /v1/models for fresh pricing
      const keys = await rt.db.db.select().from(providerKeys).where(eq(providerKeys.providerId, p.id)).limit(1);
      const apiKey = keys[0] ? await decryptKeySecret(rt, keys[0]) : "";
      try {
        const upstreamModels = await fetchUpstreamModels(p.baseUrl, apiKey);
        for (const um of upstreamModels) {
          const umRecord = um as unknown as Record<string, unknown>;
          const { input, output } = extractPricing(umRecord);
          const ctx = extractContextWindow(umRecord);
          if (input !== null) {
            pricesFound++;
            if (umRecord.pricing || umRecord.cost) pricesFromAPI++; else pricesFromTable++;
            await rt.db.db.update(models).set({
              inputPricePer1m: input, outputPricePer1m: output, contextWindow: ctx,
              raw: um as unknown as Record<string, unknown>,
            }).where(and(eq(models.providerId, p.id), eq(models.upstreamId, um.id)));
          } else {
            pricesUnknown++;
          }
        }
      } catch {
        // Upstream fetch failed — apply built-in table only
        const storedModels = await rt.db.db.select({ id: models.id, upstreamId: models.upstreamId }).from(models).where(eq(models.providerId, p.id));
        for (const m of storedModels) {
          const { input, output } = extractPricing({ id: m.upstreamId });
          if (input !== null) {
            pricesFound++; pricesFromTable++;
            await rt.db.db.update(models).set({ inputPricePer1m: input, outputPricePer1m: output }).where(eq(models.id, m.id));
          } else {
            pricesUnknown++;
          }
        }
      }
    }
    await writeAudit(rt, c.get("user").id, "providers.import", "provider", undefined, { providersAdded, providersUpdated, modelsAdded, modelsUpdated, pricesFound });
    return c.json({ import: { providersAdded, providersUpdated, modelsAdded, modelsUpdated, pricesFound, pricesFromAPI, pricesFromTable, pricesUnknown } });
  });

  // ── Scrape prices from stored raw jsonb + built-in table ───
  // ponytail: no upstream call — reads the raw column already in DB. Tries
  // upstream pricing fields first, then falls back to the built-in DO table.
  app.post("/:id/scrape-prices", async (c) => {
    const id = c.req.param("id");
    const allModels = await rt.db.db
      .select({ id: models.id, upstreamId: models.upstreamId, raw: models.raw })
      .from(models)
      .where(eq(models.providerId, id));
    let scraped = 0, fromAPI = 0, fromTable = 0, unknown = 0;
    for (const m of allModels) {
      const raw = (m.raw ?? {}) as Record<string, unknown>;
      const { input, output } = extractPricing(raw);
      const ctx = extractContextWindow(raw);
      // Check if price came from API (raw has cost/pricing fields) or table
      const hasApiPricing = raw.pricing || raw.cost;
      if (input !== null) {
        if (hasApiPricing) fromAPI++; else fromTable++;
        await rt.db.db.update(models).set({
          inputPricePer1m: input, outputPricePer1m: output, contextWindow: ctx,
        }).where(eq(models.id, m.id));
        scraped++;
      } else {
        unknown++;
      }
    }
    await invalidateModelCache(rt);
    await writeAudit(rt, c.get("user").id, "provider.scrape_prices", "provider", id, { scraped, fromAPI, fromTable, unknown });
    return c.json({ scraped, fromAPI, fromTable, unknown });
  });

  // ── Key health (real-time from Redis) ──────────────────────
  app.get("/:id/health", async (c) => {
    const id = c.req.param("id");
    const keys = await rt.db.db
      .select({ id: providerKeys.id, label: providerKeys.label, status: providerKeys.status })
      .from(providerKeys)
      .where(eq(providerKeys.providerId, id));
    const healths = await Promise.all(keys.map(async (k) => {
      const h = await getKeyHealth(rt.redis, k.id);
      const cooldownRemaining = h.cooldownUntil > 0 ? Math.max(0, h.cooldownUntil - Date.now()) : 0;
      return {
        id: k.id, label: k.label, status: k.status,
        inflight: h.inflight,
        circuitOpen: h.circuitOpen,
        cooldownMs: cooldownRemaining,
        healthy: h.available,
      };
    }));
    return c.json({ keys: healths });
  });

  return app;
}