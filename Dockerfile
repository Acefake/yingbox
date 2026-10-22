# 影盒片库服务（网页端 + 片库 / 番号刮削 API），给 NAS / Docker 用；桌面端不需要它。决策见 docs/adr/0010-docker-nas-deploy.md。
# 构建：docker build -t yingbox-library .（国内可加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com）
# 运行：docker-compose.yml 与 docs/deploy/nas.md
#
# 纯 JS / wasm（node:sqlite、@jsquash 编解码），没有原生依赖，同一份文件可构建 amd64 / arm64。
# 基础镜像写死版本号 + 摘要（多架构索引）：升级时两处一起改，四个阶段用同一个。

# ---- base：Node + 固定版本的 pnpm（只给构建阶段用）----
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY \
    npm_config_registry=$NPM_REGISTRY \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./

# ---- deps：全部依赖（构建用）。--ignore-scripts：不下载 Electron 二进制、不跑 electron-builder 的 postinstall ----
FROM base AS deps
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- build：服务（out/server）与网页端（dist-web）----
FROM deps AS build
COPY . .
RUN pnpm build:server && pnpm build:web

# ---- prod-deps：只装运行依赖 ----
FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ---- runtime：不带 pnpm / 源码 / 开发依赖 ----
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/dist-web ./dist-web
COPY docker/entrypoint.sh docker/healthcheck.mjs ./docker/

# 监听地址不在这里改：服务默认只听 127.0.0.1，对外要在运行时显式设 YINGBOX_HOST=0.0.0.0 并给足够长的令牌（见 compose）
ENV NODE_ENV=production \
    YINGBOX_DATA_DIR=/config \
    YINGBOX_CACHE_DIR=/cache \
    YINGBOX_MEDIA_ROOTS=/media \
    YINGBOX_WEB_DIR=/app/dist-web
RUN mkdir -p /config /cache /media
VOLUME ["/config", "/cache"]
EXPOSE 31480

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/docker/healthcheck.mjs"]
# 以 root 进入口：整理 /config、/cache 的属主后降权成 PUID:PGID（默认 1000:1000）再 exec 服务，见 docker/entrypoint.sh
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "out/server/server.js"]
