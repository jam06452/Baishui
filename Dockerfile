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
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app

# Copy the fully built workspace (source + dist + node_modules).
# Image is larger but the build is simple, correct, and fast.
COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]