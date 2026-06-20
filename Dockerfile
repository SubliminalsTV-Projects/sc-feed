# syntax=docker/dockerfile:1
# Replaces the nixpacks build pack. Two reasons it's much faster on warm rebuilds:
#  1. No Nix toolchain to rebuild each deploy (nixpacks spent ~76s on `nix-env`).
#  2. BuildKit cache mounts persist the npm cache + Next's .next/cache across builds, so
#     `npm ci` and `next build` reuse work instead of running fully cold every time.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Playwright is a devDependency (only the Monitarr cron uses it, and next.config externalizes
# it) — don't let its install pull ~150MB of browsers into the build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NEXT_TELEMETRY_DISABLED=1

# Install deps first so this layer caches unless the lockfile changes; the npm cache mount
# survives across builds (independent of Docker image pruning).
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

# NEXT_PUBLIC_* are baked at build time — Coolify passes build-time env as build args.
ARG NEXT_PUBLIC_GA_ID=""
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID

# .next/cache mount = warm incremental builds (kills the "No build cache found" cold compile).
RUN --mount=type=cache,target=/app/.next/cache npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
