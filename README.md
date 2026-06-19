# Baishui

A self-hostable, BYOK (Bring Your Own Key) OpenRouter-equivalent API proxy. Users register their own provider API keys; the platform auto-discovers models, routes requests with fallback chains, and exposes an OpenRouter-compatible API surface. PostgreSQL is the sole durable store; Redis holds ephemeral hot-path state (rate limits, inflight counters, key health).

## Status

Phase 0 scaffold — monorepo, Drizzle schema, role-based runtime, health endpoints, migration + owner bootstrap on startup.

## Stack

- **Proxy + management API**: Hono (Node)
- **ORM**: Drizzle (node-postgres driver)
- **Background jobs**: pg-boss (PostgreSQL-backed queue)
- **Ephemeral state**: Redis (ioredis)
- **Auth**: Lucia (DB sessions) + Arctic (GitHub OAuth, PKCE) — Phase 1
- **Encryption**: AES-256-GCM envelope encryption (`@noble/ciphers`)
- **Monorepo**: pnpm workspaces

## Quick start

```bash
cp .env.example .env
# generate a real master key
openssl rand -hex 32 | tr -d '\n' | sed -i "s/^PROXY_ENCRYPTION_ROOT_KEY=.*/PROXY_ENCRYPTION_ROOT_KEY=$(cat)/" .env
# or edit .env manually

docker compose up --build
```

Then:

- `GET http://localhost:8080/healthz` → liveness
- `GET http://localhost:8080/readyz` → readiness (PG + Redis + queue)

## Layout

```
apps/server        Hono role-based runtime (proxy | worker | all | web)
packages/config    zod-validated env loader
packages/db        Drizzle schema, migrations, client, owner bootstrap
packages/crypto    AES-256-GCM envelope encryption
packages/redis     ioredis client wrapper
packages/shared    shared types and constants
```

## Roles

The single `apps/server` image runs different code paths based on `ROLE`:

- `proxy`  — serves `/v1/*` (OpenRouter-compatible) and `/api/*` (management)
- `worker` — runs pg-boss workers (usage rollups, model sync, quota reset, key health probes)
- `all`    — proxy + worker in one process (single-container deployments)
- `web`    — reserved for the Next.js dashboard (Phase 6)

## Development

```bash
pnpm install
pnpm db:generate    # generate SQL migrations from schema
pnpm db:migrate     # apply migrations (needs PG running)
pnpm dev            # run server with tsx watch
pnpm typecheck
```