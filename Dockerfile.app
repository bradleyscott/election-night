# Combined production image: dashboard server + collector in one
# machine. The collector polls the Electoral Commission XML feed over plain
# HTTPS (no browser, no residential egress required) and talks to the
# dashboard server over loopback:
#
#   WS_URL=ws://127.0.0.1:3456
#   HISTORY_UPSTREAM=http://127.0.0.1:3459
#
# Only port 3456 is public. SQLite and the caches live on a mounted volume
# (see fly.toml).

FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/collector/package.json packages/collector/
COPY packages/dashboard/package.json packages/dashboard/

RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/ packages/core/
COPY packages/collector/ packages/collector/
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

# Build revision for `election_build_info` (correlates graphs with deploys).
ARG GIT_SHA="unknown"
ENV GIT_SHA=$GIT_SHA

RUN apt-get update && apt-get install -y --no-install-recommends bash \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data

COPY --from=builder /app /app
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

# 3456: dashboard server (public). 3459: collector health/metrics/history
# (loopback in production; also scraped by Fly's metrics collector).
EXPOSE 3456 3459
CMD ["bash", "/app/docker/entrypoint.sh"]
