# 影盒片库服务（网页端 + 片库 / 刮削 API），给 NAS / Docker 用；桌面端不需要它。决策见 docs/adr/0010-docker-nas-deploy.md。
# 构建：docker build -t yingbox-library .（国内可加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com）
# 运行：docker-compose.yml 与 docs/deploy/nas.md
#
# 纯 JS / wasm（node:sqlite、@jsquash 编解码），没有原生依赖，同一份文件可构建 amd64 / arm64。
# 在线板块（ADR-0019）默认不带浏览器；--build-arg WITH_CHROMIUM=1 装上 Debian 的 chromium + playwright-core，
# 再在运行时设 YINGBOX_BROWSER=chromium:/usr/bin/chromium，被 Cloudflare 挑战拦下的源才能由无头浏览器代抓。
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
# 按画面搜的推理运行时只留 Linux 版（其他平台的二进制有两百多 MB）
RUN find node_modules/.pnpm -path '*onnxruntime-node/bin/napi-v6/*' -maxdepth 6 -mindepth 6 \( -name darwin -o -name win32 \) -prune -exec rm -rf {} + || true

# ---- browser-deps：可选的 playwright-core（WITH_CHROMIUM=1 时）。它没有依赖，直接解包，不经 pnpm、不改锁文件 ----
FROM base AS browser-deps
ARG WITH_CHROMIUM=0
ARG PLAYWRIGHT_CORE_VERSION=1.64.1
RUN mkdir -p /opt/browser-modules && if [ "$WITH_CHROMIUM" = 1 ]; then \
      cd /tmp && npm pack "playwright-core@$PLAYWRIGHT_CORE_VERSION" --silent \
      && mkdir -p /opt/browser-modules/playwright-core \
      && tar -xzf playwright-core-*.tgz -C /opt/browser-modules/playwright-core --strip-components=1; \
    fi

# ---- runtime：不带 pnpm / 源码 / 开发依赖 ----
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/dist-web ./dist-web
COPY docker/entrypoint.sh docker/healthcheck.mjs ./docker/

# 可选：在线板块的浏览器代抓（系统 Chromium + 上一阶段解包的 playwright-core）与中文字体；
# ffmpeg 给下载完成后的 .ts → .mp4 无损转封装（没有时保留 .ts），同包的 ffprobe 给片库探测 HDR / 杜比视界与内封字幕
ARG WITH_CHROMIUM=0
COPY --from=browser-deps /opt/browser-modules/ ./node_modules/
RUN if [ "$WITH_CHROMIUM" = 1 ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# 监听地址不在这里改：服务默认只听 127.0.0.1，对外要在运行时显式设 YINGBOX_HOST=0.0.0.0 并给足够长的令牌（见 compose）
ENV NODE_ENV=production \
    YINGBOX_DATA_DIR=/config \
    YINGBOX_CACHE_DIR=/cache \
    YINGBOX_MEDIA_ROOTS=/media \
    YINGBOX_DOWNLOAD_DIR=/downloads \
    YINGBOX_WEB_DIR=/app/dist-web
RUN mkdir -p /config /cache /media /downloads
VOLUME ["/config", "/cache"]
EXPOSE 31480

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/docker/healthcheck.mjs"]
# 以 root 进入口：整理 /config、/cache 的属主后降权成 PUID:PGID（默认 1000:1000）再 exec 服务，见 docker/entrypoint.sh
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "out/server/server.js"]
