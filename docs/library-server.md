# 片库服务（网页端 / NAS）

影盒的本地媒体库（电影、剧集、番号库）原来只能在桌面版里用：扫描、刮削、写 NFO 都在 Electron 的 utilityProcess 里跑。
片库服务把这套核心原样搬到一个独立的 Node 进程里，通过 HTTP 提供给网页端，可以跑在本机、开发机或 NAS 的 Docker 里。

桌面版不需要它，也不会连它：桌面端照旧走 IPC。

## 架构

```
浏览器（dist-web）                         片库服务（out/server/server.js，Node 22+）
┌──────────────────────────┐   HTTP     ┌─────────────────────────────────────────────┐
│ features/library         │  ───────▶  │ src/server                                  │
│   api/bridge.ts          │  POST rpc  │   http/   路由、鉴权（Bearer / Cookie）、静态 │
│   └ http-bridge.ts ──────┼──────────▶ │   routes/ library（rpc + SSE）、media、fs    │
│ services/library-server  │  SSE       │                                             │
│   登录、连接状态、媒体地址 │ ◀──────── │ src/main/library/platform                   │
│ <img>  /media/image|thumb│ ◀──────── │   createLibraryService ── 片库核心（与桌面同一份）│
│ <video> /media/files Range│ ◀─────── │   fetch：undici / curl(-impersonate) / module:│
└──────────────────────────┘            │ src/main/thumbnails  wasm 解码 / 缩放 / WebP   │
                                        └─────────────────────────────────────────────┘
```

- **同一个片库核心**：扫描、识别（TMDB / 番号站点）、刮削、写出 NFO 与图片、整理改名，全部来自 `src/main/library`。
  宿主差异只在 `src/main/library/platform`（`LibraryPlatform` 接口）：桌面端注入 Electron `net.fetch`，服务端注入 Node 的出网实现。
- **同一份契约**：`POST /api/library/rpc` 的 `{ method, params }` 与桌面端 IPC 的方法、参数、返回值一字不差（参数校验复用 `engine/rpc.ts`）；
  事件经 SSE（`GET /api/library/events`）推送，每条 `data` 是一个 `LibraryEvent`。线格式见 `src/shared/library/ipc/contract-http.ts`。
- **网页端 transport**：`features/library/api/bridge.ts` 按运行环境选 transport。有 `window.api`（Electron）走 IPC，否则走 `http-bridge.ts`。界面代码不区分两者。
- **缩略图**：桌面端用 `nativeImage`；服务端用 `@jsquash` 的 wasm 编解码，在独立线程里解码、缩放、编码 WebP（`thumbnails/wasm-resizer.ts`、`codec-*.ts`）。两边共用同一个 LRU 缓存目录结构。

| 桌面端（Electron）               | 片库服务（Node）                                      |
| -------------------------------- | ----------------------------------------------------- |
| utilityProcess + MessagePort IPC | 同进程 LibraryService + HTTP RPC / SSE                |
| `net.fetch`（Chromium 网络栈）   | Node fetch（undici）/ curl(-impersonate) / 自定义模块 |
| `nativeImage` 缩放               | wasm 解码 + 缩放（编解码线程）                        |
| safeStorage 存 TMDB 令牌         | `<数据目录>/secrets.json`（0600）+ 环境变量           |
| 系统文件夹对话框                 | `/api/fs/dirs`：只在媒体根目录内浏览                  |
| 内置播放器 / mpv                 | 网页 `<video>` + `/media/files/<id>` Range 流         |

### 接口一览

| 路径                    | 方法          | 说明                                                    |
| ----------------------- | ------------- | ------------------------------------------------------- |
| `/api/health`           | GET           | 健康检查（公开），返回 `{ ok, authorized }`             |
| `/api/session`          | POST / DELETE | 用令牌登录（写 HttpOnly Cookie）/ 退出（公开）          |
| `/api/info`             | GET           | 媒体根目录、出网实现                                    |
| `/api/library/rpc`      | POST          | 片库方法调用，返回 `InvokeResult`                       |
| `/api/library/events`   | GET           | SSE 事件流                                              |
| `/api/fs/dirs?path=`    | GET           | 目录浏览（不带 path 列出媒体根目录）                    |
| `/media/image/<key>?w=` | GET           | 片库缓存的海报 / 背景图（可按宽度取缩略图）             |
| `/media/thumb?w=&src=`  | GET           | 远程图片代取 + 缩放（只接受 http(s)，带防盗链 Referer） |
| `/media/files/<fileId>` | GET           | 视频文件，支持 Range（206 / 416）                       |

### 鉴权

- 所有接口（`/api/health`、`/api/session` 与网页静态文件除外）都要令牌：`Authorization: Bearer <令牌>`，或登录后服务写入的 Cookie。
- Cookie 是 `HttpOnly` + `SameSite=Strict`，页面脚本拿不到令牌，`<img>` / `<video>` / `EventSource` 自动带上；令牌不出现在资源地址里。
- 改写类请求校验同源（`Origin`），防跨站调用。
- 令牌来源：`YINGBOX_SERVER_TOKEN` 环境变量；没设时首次启动随机生成（32 字节），存进 `<数据目录>/secrets.json` 并打印在启动日志里。
- 启动日志里的 `http://…/?token=…` 只需打开一次：服务把它换成 Cookie 并从地址栏去掉令牌。

## 配置

命令行参数 > 环境变量 > 默认值（`src/server/config.ts`）。

| 参数                     | 环境变量                                  | 默认                          | 说明                                                                                     |
| ------------------------ | ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `--host`                 | `YINGBOX_HOST`                            | `127.0.0.1`                   | 监听地址。默认只有本机能访问；局域网访问设 `0.0.0.0`                                     |
| `--port`                 | `YINGBOX_PORT`                            | `31480`                       | 端口                                                                                     |
| `--data-dir`             | `YINGBOX_DATA_DIR`                        | `~/.yingbox-server`           | `library.db`、`media/`（原图与缩略图缓存）、`secrets.json`                               |
| `--media-root`（可多次） | `YINGBOX_MEDIA_ROOTS`                     | 用户主目录                    | 允许浏览和建库的根目录；环境变量里多个用系统路径分隔符（Linux / macOS `:`，Windows `;`） |
| `--web-dir`              | `YINGBOX_WEB_DIR`                         | 包旁边的 `dist-web`（存在时） | 托管的网页端目录；`off` 只提供 API                                                       |
| `--fetch`                | `YINGBOX_FETCH`                           | `node`                        | 出网实现：`node` / `curl` / `curl:<路径>` / `module:<路径>`，见下文                      |
| —                        | `YINGBOX_SERVER_TOKEN`                    | 首次启动生成                  | 访问令牌（只读覆盖，不写回文件）                                                         |
| —                        | `YINGBOX_TMDB_TOKEN`                      | 无                            | TMDB 读访问令牌（电影 / 剧集库需要，番号库不需要）。网页端设置里填写的令牌优先           |
| —                        | `YINGBOX_OPENSUBTITLES_KEY`               | 无                            | OpenSubtitles API key（按文件哈希辅助识别，可选）                                        |
| —                        | `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | 无                            | 出网代理，见下文                                                                         |
| —                        | `NODE_USE_ENV_PROXY`                      | 无                            | 设为 `1` 时 Node fetch 才读上面三个代理变量                                              |

数据目录里的 `secrets.json` 存着访问令牌和网页端填写的 TMDB 令牌。NAS 上没有系统密钥链，安全性等于这个文件的权限（服务会设成 0600），请让数据目录只对服务用户可读。

## 部署

### 本机（直接跑构建产物）

```bash
pnpm install
pnpm build:server && pnpm build:web
pnpm start:server                       # = node --disable-warning=ExperimentalWarning out/server/server.js
# 或带参数：
node --disable-warning=ExperimentalWarning out/server/server.js \
  --media-root ~/Movies --media-root /Volumes/Video
```

浏览器打开日志里的 `http://127.0.0.1:31480/?token=…`。默认只监听 `127.0.0.1`，同一台机器以外访问不到；要给局域网用，加 `--host 0.0.0.0`，并确认令牌足够长。

需要 Node 22+（用到 `node:sqlite`；`--disable-warning=ExperimentalWarning` 只是去掉它的实验提示）。

### 开发

```bash
pnpm dev:server     # tsx watch，改 src/server 或片库核心后自动重启（端口 31480）
pnpm dev:web        # vite，/api 与 /media 代理到 YINGBOX_SERVER_TARGET（默认 http://127.0.0.1:31480）
```

`dev:web` 经代理访问时，服务不托管页面，地址栏的 `?token=` 由网页端自己换成 Cookie。

检查脚本：

- `pnpm smoke:server`：起一个临时服务，出网用离线夹具（`scripts/smoke/fixture-fetch.mjs`），走一遍 登录 → 目录浏览 → SSE → 建番号库 → 识别 → 详情 → 图片 → Range 流 → 根目录限制 → 托管网页。
- `node scripts/smoke-server.mjs --online`：同上，但用真实网络，看番号站点在当前网络下是否可达（被 Cloudflare 拦下属正常，按主机熔断后跳过）。
- `node scripts/web-e2e.mjs`：用 Playwright 驱动网页端完整走一遍（需先 `build:web`、`build:server`；Playwright 不是项目依赖，用 `PLAYWRIGHT_MODULE` 指向自备的模块）。不进 CI。

### NAS（Docker）

仓库根目录有 `Dockerfile` 和 `docker-compose.example.yml`。镜像只含服务和网页端，没有原生依赖（`node:sqlite` + wasm），amd64 / arm64 都能构建。

```bash
cp docker-compose.example.yml docker-compose.yml
# 改：YINGBOX_SERVER_TOKEN、user（UID:GID）、媒体目录挂载
docker compose up -d --build
docker compose logs yingbox          # 首次启动的地址与令牌
```

要点：

- 容器里默认 `YINGBOX_HOST=0.0.0.0`、`YINGBOX_DATA_DIR=/data`、`YINGBOX_MEDIA_ROOTS=/media`；把媒体目录挂到 `/media/...` 下面，数据目录挂到 `/data`。
- `user:` 设成媒体文件属主的 UID:GID（群晖 / 威联通在用户管理里能查到），否则写 NFO、整理改名会没有权限。
- 媒体目录可以只读挂载（`:ro`）：浏览、扫描、刮削、播放都正常，只是写出和整理会失败。
- 镜像自带 `HEALTHCHECK`（`/api/health`）。
- 想从外网访问，放在反向代理（HTTPS）后面，不要直接把端口暴露到公网。

## 代理

服务端的 Node fetch（undici）默认**不读**代理环境变量。需要代理才能访问 TMDB / 番号站点时：

```bash
HTTPS_PROXY=http://192.168.1.2:7890 \
HTTP_PROXY=http://192.168.1.2:7890 \
NO_PROXY=localhost,127.0.0.1 \
NODE_USE_ENV_PROXY=1 \
pnpm start:server
```

`NODE_USE_ENV_PROXY=1` 必须一起设（Node 22.21+ / 24 支持），否则 `HTTPS_PROXY` 不生效。Docker 里同样写进 `environment:`（compose 示例里有注释好的几行）。

`--fetch curl` 时代理由 curl 自己读同名环境变量，不需要 `NODE_USE_ENV_PROXY`。

## curl-impersonate

部分番号站点用 Cloudflare 按 TLS / HTTP2 指纹拦截非浏览器客户端。桌面版用的是 Chromium 网络栈，不受影响；服务端的 Node fetch 指纹和浏览器不同，可能被拦。
这时可以改用 [curl-impersonate](https://github.com/lwthiker/curl-impersonate)（或其维护分支），它的包装脚本与普通 curl 命令行兼容：

```bash
# 例：装好后用 Chrome 指纹的包装脚本
node out/server/server.js --fetch curl:/usr/local/bin/curl_chrome116
# 或
YINGBOX_FETCH=curl:/usr/local/bin/curl_chrome116 pnpm start:server
```

- `--fetch curl` 用系统 curl（指纹和 Node 差不多，主要用来验证接线）。
- 一次请求一个 curl 进程，超时 30 秒、响应体上限 32 MB；取消请求会结束子进程。
- 不管用哪种实现，被 Cloudflare 硬封锁时都会由番号源的按主机熔断跳过，不会反复请求。
- Docker 镜像里没有 curl-impersonate；需要的话基于镜像加一层安装，再设 `YINGBOX_FETCH`。
- `module:<路径>`：自定义模块，导出 `createFetch()`（返回 `HttpFetch`），用于接其它实现或离线回放。

## 网页端能做什么

能做：

- 登录片库服务（令牌一次，之后靠 Cookie）。
- 在媒体根目录内浏览文件夹，添加电影 / 剧集 / 番号库；删除库、扫描、识别全部、刷新元数据。
- 海报墙（排序、筛选、搜索、分库）、待确认队列、修正匹配、锁定。后台进度与条目变化经 SSE 实时刷新。
- 条目详情；在页内 `<video>` 播放（分段电影、一季的集按顺序连播），视频经 Range 流拖动。
- 媒体库设置里填写 TMDB 令牌（存在服务端）、番号站点优先级。
- 写出 NFO / 图片、整理改名：在服务端执行，需要媒体目录可写。

不能做（或受限）：

- 浏览器解码能力有限：MP4 / WebM 里的 H.264、VP9、AV1 一般没问题；MKV、HEVC、DTS 音轨等视浏览器而定，播不了时界面提示改用桌面版。没有服务端转码。
- 没有 mpv、内置播放器窗口、外挂字幕自动挂载。
- 只能访问媒体根目录以内的文件夹（服务端强制）。
- 在线播放、MissAV、下载、Amane、lada 这些板块不在片库服务里，网页端仍不可用。
- 网页端只连同源的片库服务，不能在页面里改连其它地址（开发时用 `dev:web` 的代理）。
