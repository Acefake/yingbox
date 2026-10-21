# 影盒片库服务（网页端 + 片库 / 番号刮削 API），给 NAS / Docker 用。桌面端不需要它。
# 构建：docker build -t yingbox-library .
# 运行：见 docker-compose.example.yml 与 docs/library-server.md
#
# 纯 JS / wasm（node:sqlite、@jsquash 编解码），没有原生依赖：同一份 Dockerfile 可构建 amd64 / arm64。

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
# --ignore-scripts：不下载 Electron 二进制、不跑 electron-builder 的 postinstall
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:server && pnpm build:web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
  && pnpm store prune \
  && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/dist-web ./dist-web

# 容器里监听所有地址（由端口映射决定谁能访问）；数据与媒体走挂载卷
ENV YINGBOX_HOST=0.0.0.0 \
    YINGBOX_PORT=31480 \
    YINGBOX_DATA_DIR=/data \
    YINGBOX_MEDIA_ROOTS=/media \
    YINGBOX_WEB_DIR=/app/dist-web
RUN mkdir -p /data /media && chown node:node /data
VOLUME ["/data"]
EXPOSE 31480
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:31480/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "out/server/server.js"]
