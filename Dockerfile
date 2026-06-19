# syntax=docker/dockerfile:1.7

# ── build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

# ── runtime stage ─────────────────────────────────────────────
# ponytail: prod-only deps — excludes esbuild, tsx, typescript (dev deps
# that bundle Go binaries with known CVEs). The app runs from compiled
# dist/ via node, so build tools aren't needed at runtime.
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy workspace manifests for prod install
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/crypto/package.json ./packages/crypto/

# Install only production dependencies (no tsx, esbuild, typescript)
RUN pnpm install --frozen-lockfile --prod --filter @baishui/server...

# Copy built dist + drizzle migrations (not source, not dev node_modules)
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/crypto/dist ./packages/crypto/dist

ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]