FROM node:22 AS builder
WORKDIR /app

ENV CLOAKBROWSER_CACHE_DIR=/app/.data/cloakbrowser
ENV CLOAKBROWSER_AUTO_UPDATE=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/collector/package.json packages/collector/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    cd packages/collector && npx cloakbrowser install && cd /app

COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/ packages/core/
COPY packages/collector/ packages/collector/
COPY packages/dashboard/ packages/dashboard/
COPY csv/ csv/

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
  --external:utf-8-validate \
  --external:better-sqlite3

RUN npx esbuild packages/collector/src/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=/app/packages/collector/dist/index.mjs \
  --external:better-sqlite3 \
  --external:bufferutil \
  --external:utf-8-validate \
  --external:puppeteer-core \
  --external:cloakbrowser

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CLOAKBROWSER_CACHE_DIR=/app/.data/cloakbrowser
ENV CLOAKBROWSER_AUTO_UPDATE=false

RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
RUN npm prune --omit=dev --ignore-scripts
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3456
CMD ["/app/entrypoint.sh"]
