FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY packages/core/ packages/core/
COPY packages/web/ packages/web/
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

COPY --from=builder /app/packages/web/dist /app/dist
COPY --from=builder /app/server.cjs /app/server.cjs

EXPOSE 3456
CMD ["node", "server.cjs"]
