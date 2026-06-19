import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Runtime } from "../lib/runtime.js";
import { requireRole, type AppVars } from "../lib/auth.js";
import { deleteAllModelsByPattern } from "../lib/cache.js";
import { routingRules, models, providers, auditLog } from "@baishui/db";

// ponytail: routing CRUD — creates aliases like "smart-model" that map to a
// priority-ordered fallback chain across providers. Request "smart-model" →
// try primary (e.g. OpenAI gpt-4o) → if key in cooldown/provider down → try
// fallback #1 (e.g. llmsolutions.top gpt-4o) → etc.

export function routingCrudRoutes(rt: Runtime): Hono<AppVars> {
  const app = new Hono<AppVars>();
  app.use("*", requireRole(rt.db.db, "admin"));

  // List all routes with joined model+provider names
  app.get("/", async (c) => {
    const rules = await rt.db.db.select().from(routingRules).orderBy(routingRules.alias);
    // join model names for display
    const enriched = await Promise.all(rules.map(async (r) => {
      const [primary] = await rt.db.db
        .select({ upstreamId: models.upstreamId, displayName: models.displayName, providerId: models.providerId })
        .from(models).where(eq(models.id, r.primaryModelId)).limit(1);
      const [prov] = primary ? await rt.db.db.select({ name: providers.name }).from(providers).where(eq(providers.id, primary.providerId)).limit(1) : [null];
      const fallbacks = await Promise.all((r.fallbackChain ?? []).map(async (f) => {
        const [m] = await rt.db.db.select({ upstreamId: models.upstreamId, displayName: models.displayName, providerId: models.providerId }).from(models).where(eq(models.id, f.modelId)).limit(1);
        const [p] = m ? await rt.db.db.select({ name: providers.name }).from(providers).where(eq(providers.id, m.providerId)).limit(1) : [null];
        return { modelId: f.modelId, priority: f.priority, model: m?.upstreamId ?? "unknown", provider: p?.name ?? "unknown" };
      }));
      return {
        id: r.id, alias: r.alias, enabled: r.enabled,
        primary: { modelId: r.primaryModelId, model: primary?.upstreamId ?? "unknown", provider: prov?.name ?? "unknown" },
        fallbacks: fallbacks.sort((a, b) => a.priority - b.priority),
      };
    }));
    return c.json({ routes: enriched });
  });

  // Create route
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.alias || !body?.primaryModelId) {
      return c.json({ error: { message: "alias and primaryModelId required", type: "bad_request" } }, 400);
    }
    const chain = (body.fallbackChain ?? []) as { modelId: string; priority: number }[];
    try {
      const [created] = await rt.db.db
        .insert(routingRules)
        .values({
          alias: body.alias,
          primaryModelId: body.primaryModelId,
          fallbackChain: chain,
          enabled: body.enabled ?? true,
          createdBy: c.get("user").id,
        })
        .returning();
      await rt.db.db.insert(auditLog).values({ actorUserId: c.get("user").id, action: "route.create", targetType: "route", targetId: created!.id, meta: { alias: body.alias } });
      await deleteAllModelsByPattern(rt.redis);
      return c.json({ route: created }, 201);
    } catch (err) {
      if (String(err).includes("unique")) return c.json({ error: { message: "alias already exists", type: "conflict" } }, 409);
      throw err;
    }
  });

  // Update route
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: { message: "body required", type: "bad_request" } }, 400);
    const updates: Partial<typeof routingRules.$inferInsert> = {};
    if (body.alias !== undefined) updates.alias = body.alias;
    if (body.primaryModelId !== undefined) updates.primaryModelId = body.primaryModelId;
    if (body.fallbackChain !== undefined) updates.fallbackChain = body.fallbackChain;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    updates.updatedAt = new Date();
    const [updated] = await rt.db.db.update(routingRules).set(updates).where(eq(routingRules.id, id)).returning();
    if (!updated) return c.json({ error: { message: "route not found", type: "not_found" } }, 404);
    await deleteAllModelsByPattern(rt.redis);
    return c.json({ route: updated });
  });

  // Delete route
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [deleted] = await rt.db.db.delete(routingRules).where(eq(routingRules.id, id)).returning({ id: routingRules.id });
    if (!deleted) return c.json({ error: { message: "route not found", type: "not_found" } }, 404);
    await deleteAllModelsByPattern(rt.redis);
    return c.json({ ok: true });
  });

  // List all models across all providers (for the route builder dropdown)
  app.get("/models", async (c) => {
    const rows = await rt.db.db
      .select({
        id: models.id, upstreamId: models.upstreamId, displayName: models.displayName,
        providerId: models.providerId, providerName: providers.name, enabled: models.enabled,
      })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(eq(models.enabled, true))
      .orderBy(providers.name, models.displayName);
    return c.json({ models: rows });
  });

  return app;
}