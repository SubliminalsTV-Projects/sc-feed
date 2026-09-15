# syntax=docker/dockerfile:1
# SC Feed public Discord bot. Build context is the REPO ROOT — the bot imports sc-feed's
# Drizzle schema from lib/db.ts. Coolify: Dockerfile build pack, base directory "/",
# Dockerfile location "/bot/Dockerfile", no domain and no exposed port (outbound-only worker).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY lib/db.ts lib/db.ts
COPY bot bot
# One self-contained file: the runtime image needs no node_modules.
RUN npm run bot:build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/bot/dist/index.js ./index.js
USER node
CMD ["node", "index.js"]
