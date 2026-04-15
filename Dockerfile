# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS app-build
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-build
WORKDIR /build/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATABASE_URL=sqlite:///data/vibestack.db \
    APP_DIST_DIR=/app/public

COPY --from=server-build /build/server/dist ./dist
COPY --from=server-build /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/package.json ./package.json
COPY --from=app-build /build/app/dist ./public

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
