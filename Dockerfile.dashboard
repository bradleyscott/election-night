# Server-only image for the dashboard server (deployed to Fly.io).
#
# The collector runs separately on the homelab (see Dockerfile.collector) and
# publishes to this server over Socket.io; history data arrives via the
# collector's /history/* REST API (HISTORY_UPSTREAM). No browser, no SQLite —
# nothing here launches cloakbrowser, so the image stays slim.

FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/collector/package.json packages/collector/
COPY packages/dashboard/package.json packages/dashboard/
# npm ci validates every workspace listed in the root package.json against
# the lockfile, so packages/collector/package.json must exist even though
# this image never runs the collector.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/ packages/core/
COPY packages/dashboard/ packages/dashboard/

RUN npm run build:core

WORKDIR /app/packages/dashboard
RUN npx vite build
WORKDIR /app

RUN npx esbuild packages/dashboard/server/index.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile=/app/server.cjs \
  --external:bufferutil \
  --external:utf-8-validate

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

EXPOSE 3456
CMD ["node", "server.cjs"]
