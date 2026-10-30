# syntax=docker/dockerfile:1
# NAS 专用版：片库与完整网盘，构建产物与桌面版分开。
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY \
    npm_config_registry=$NPM_REGISTRY \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

FROM base AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm typecheck:node && pnpm typecheck:web && pnpm build:nas

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
RUN find node_modules/.pnpm -path '*onnxruntime-node/bin/napi-v6/*' -maxdepth 6 -mindepth 6 \( -name darwin -o -name win32 \) -prune -exec rm -rf {} +

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/out/nas ./out/nas
COPY --from=build /app/dist-nas ./dist-nas
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY docker/entrypoint.sh docker/healthcheck.mjs ./docker/
COPY scripts/smoke-nas.mjs ./docker/smoke-nas.mjs
ENV NODE_ENV=production \
    YINGBOX_DATA_DIR=/config \
    YINGBOX_CACHE_DIR=/cache \
    YINGBOX_MEDIA_ROOTS=/media \
    YINGBOX_WEB_DIR=/app/dist-nas
RUN mkdir -p /config /cache /media \
    && node docker/smoke-nas.mjs
VOLUME ["/config", "/cache"]
EXPOSE 31480
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/docker/healthcheck.mjs"]
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "out/nas/server.js"]
