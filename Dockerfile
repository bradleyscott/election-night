FROM node:22 AS builder
WORKDIR /app

ENV CLOAKBROWSER_CACHE_DIR=/app/.cache/cloakbrowser
ENV CLOAKBROWSER_AUTO_UPDATE=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN npm ci && npx cloakbrowser install

COPY packages/core/ packages/core/
COPY packages/cli/ packages/cli/
COPY packages/web/ packages/web/
COPY csv/ csv/

WORKDIR /app/packages/web
RUN npx vite build
WORKDIR /app

RUN npx esbuild packages/web/server/index.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile=/app/server.cjs \
  --external:bufferutil \
  --external:utf-8-validate

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CLOAKBROWSER_CACHE_DIR=/app/.cache/cloakbrowser
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
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3456
CMD ["/app/entrypoint.sh"]
