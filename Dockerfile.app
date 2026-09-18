# Production image: the dashboard server and the collector in ONE process.
#
# The collector runs in-process (see packages/dashboard/server/index.ts), so
# there is no supervisor, no Socket.io hop between processes, and no history
# HTTP API — the server reads the same SQLite file the collector writes.
#
# The server is run from TypeScript via tsx rather than bundled: bundling would
# break better-sqlite3 (a native module) and drizzle's on-disk migrations.
# tsx is already required by the collector's source imports, so this costs
# nothing extra.
#
# SQLite and the feed-event cache live on the mounted volume (see fly.toml).

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

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

RUN mkdir -p /data

COPY --from=builder /app /app

EXPOSE 3456
CMD ["node", "--import", "tsx", "packages/dashboard/server/index.ts"]
