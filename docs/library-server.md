# 片库服务（网页端 / NAS）

影盒的本地媒体库（电影、剧集）原来只能在桌面版里用：扫描、刮削、写 NFO 都在 Electron 的 utilityProcess 里跑。
片库服务把这套核心原样搬到一个独立的 Node 进程里，通过 HTTP 提供给网页端，可以跑在本机、开发机或 NAS 的 Docker 里。

桌面版不需要它，也不会连它：桌面端照旧走 IPC。在线板块（搜索、播放、测速、豆瓣浏览、AV、下载）也能在服务上跑，见「在线播放」。

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

- **同一个片库核心**：扫描、识别（TMDB 等元数据源）、刮削、写出 NFO 与图片、整理改名，全部来自 `src/main/library`。
  宿主差异只在 `src/main/library/platform`（`LibraryPlatform` 接口）：桌面端注入 Electron `net.fetch`，服务端注入 Node 的出网实现。
- **同一份契约**：`POST /api/library/rpc` 的 `{ method, params }` 与桌面端 IPC 的方法、参数、返回值一字不差（参数校验复用 `engine/rpc.ts`）；
  事件经 SSE（`GET /api/library/events`）推送，每条 `data` 是一个 `LibraryEvent`。线格式见 `src/shared/library/ipc/contract-http.ts`。
- **网页端 transport**：`features/library/api/bridge.ts` 按运行环境选 transport。有 `window.api`（Electron）走 IPC，否则走 `http-bridge.ts`。界面代码不区分两者。
- **缩略图**：桌面端用 `nativeImage`；服务端用 `@jsquash` 的 wasm 编解码，在独立线程里解码、缩放、编码 WebP（`thumbnails/wasm-resizer.ts`、`codec-*.ts`）。两边共用同一个 LRU 缓存目录结构。

| 桌面端（Electron）                       | 片库服务（Node）                                                     |
| ---------------------------------------- | -------------------------------------------------------------------- |
| utilityProcess + MessagePort IPC         | 同进程 LibraryService + HTTP RPC / SSE                               |
| `net.fetch`（Chromium 网络栈）           | Node fetch（undici）/ curl(-impersonate) / 自定义模块                |
| `nativeImage` 缩放                       | wasm 解码 + 缩放（编解码线程）                                       |
| safeStorage 存 TMDB 令牌                 | `<数据目录>/secrets.json`（0600）+ 环境变量                          |
| 系统文件夹对话框                         | `/api/fs/dirs`：只在媒体根目录内浏览                                 |
| 内置播放器 / mpv                         | 网页端播放层（桌面端为独立播放器窗口）+ `/media/files/<id>` Range 流 |
| 在线引擎 utilityProcess + IPC            | child_process 引擎（同一个 `EngineHost`）+ `/api/engine/rpc`、SSE    |
| `yingbox-stream://` + `media-headers.ts` | `/api/stream`（鉴权、防 SSRF、按源 Referer、m3u8 改写、Range）       |

### 接口一览

| 路径                    | 方法          | 说明                                                     |
| ----------------------- | ------------- | -------------------------------------------------------- |
| `/api/health`           | GET           | 健康检查（公开），返回 `{ ok, authorized }`              |
| `/api/session`          | POST / DELETE | 用令牌登录（写 HttpOnly Cookie）/ 退出（公开）           |
| `/api/info`             | GET           | 媒体根目录、出网实现                                     |
| `/api/library/rpc`      | POST          | 片库方法调用，返回 `InvokeResult`                        |
| `/api/library/events`   | GET           | SSE 事件流                                               |
| `/api/fs/dirs?path=`    | GET           | 目录浏览（不带 path 列出媒体根目录）                     |
| `/media/image/<key>?w=` | GET           | 片库缓存的海报 / 背景图（可按宽度取缩略图）              |
| `/media/thumb?w=&src=`  | GET           | 远程图片代取 + 缩放（只接受 http(s)，带防盗链 Referer）  |
| `/media/files/<fileId>` | GET           | 视频文件，支持 Range（206 / 416）                        |
| `/api/engine/rpc`       | POST          | 在线引擎调用 `{ channel, args }`，返回 `EngineRpcResult` |
| `/api/engine/events`    | GET           | 在线引擎事件（SSE，如 `download:changed`）               |
| `/api/stream?src=`      | GET           | 在线播放代理（Range、按源 Referer、m3u8 改写）           |

### 鉴权

- 所有接口（`/api/health`、`/api/session` 与网页静态文件除外）都要令牌：`Authorization: Bearer <令牌>`，或登录后服务写入的 Cookie。
- Cookie 是 `HttpOnly` + `SameSite=Strict`，页面脚本拿不到令牌，`<img>` / `<video>` / `EventSource` 自动带上；令牌不出现在资源地址里。
- 改写类请求校验完整同源（协议、主机和端口），防跨站调用。
- HTTPS 反向代理部署时设置 `YINGBOX_PUBLIC_ORIGIN=https://media.example.com`（或 `--public-origin`），登录和退出 Cookie 带 `Secure`，同源检查使用此固定源。服务不采用客户端的 `X-Forwarded-*` 头；只在本地用 HTTP 时无需设置。
- 令牌来源：`YINGBOX_SERVER_TOKEN` 环境变量；没设时首次启动随机生成（32 字节），存进 `<数据目录>/secrets.json` 并打印在启动日志里。
- 对外监听（`--host` 不是 `127.0.0.1` / `::1` / `localhost`）时必须用环境变量显式设置令牌：至少 24 个字符、不是示例占位串，否则服务拒绝启动（`src/server/exposure.ts`，ADR-0010）。
- 启动日志里的 `http://…/?token=…` 只需打开一次：服务把它换成 Cookie 并从地址栏去掉令牌。

## 配置

命令行参数 > 环境变量 > 默认值（`src/server/config.ts`）。

| 参数                     | 环境变量                                  | 默认                          | 说明                                                                                     |
| ------------------------ | ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `--host`                 | `YINGBOX_HOST`                            | `127.0.0.1`                   | 监听地址。默认只有本机能访问；局域网访问设 `0.0.0.0`，这时必须设 `YINGBOX_SERVER_TOKEN`  |
| `--public-origin`        | `YINGBOX_PUBLIC_ORIGIN`                   | 无                            | 对外访问的 HTTP(S) 源；HTTPS 反向代理部署时必设，例如 `https://media.example.com`        |
| `--port`                 | `YINGBOX_PORT`                            | `31480`                       | 端口                                                                                     |
| `--data-dir`             | `YINGBOX_DATA_DIR`                        | `~/.yingbox-server`           | `library.db`、`secrets.json`                                                             |
| `--cache-dir`            | `YINGBOX_CACHE_DIR`                       | 同数据目录                    | `media/`（海报原图与缩略图）等缓存；Docker 里是 `/cache` 卷                              |
| `--media-root`（可多次） | `YINGBOX_MEDIA_ROOTS`                     | 用户主目录                    | 允许浏览和建库的根目录；环境变量里多个用系统路径分隔符（Linux / macOS `:`，Windows `;`） |
| `--web-dir`              | `YINGBOX_WEB_DIR`                         | 包旁边的 `dist-web`（存在时） | 托管的网页端目录；`off` 只提供 API                                                       |
| `--fetch`                | `YINGBOX_FETCH`                           | `node`                        | 出网实现：`node` / `curl` / `curl:<路径>` / `module:<路径>`，见下文                      |
| `--watch`                | `YINGBOX_WATCH`                           | `auto`                        | 目录监控模式：`auto` / `events` / `poll` / `off`，见「自动入库」                         |
| `--scan-interval`        | `YINGBOX_SCAN_INTERVAL`                   | `300`（秒）                   | 定时增量扫描间隔；`0` 关闭（网络盘上就只能手动扫描了）                                   |
| `--settle`               | `YINGBOX_SETTLE_SECONDS`                  | `10`（秒）                    | 写入稳定判定：新文件大小与 mtime 保持这么久不变才入库；`0` 不判定                        |
| —                        | `YINGBOX_SERVER_TOKEN`                    | 首次启动生成                  | 访问令牌（只读覆盖，不写回文件）；对外监听时必填，至少 24 个字符                         |
| —                        | `YINGBOX_TMDB_TOKEN`                      | 无                            | TMDB 读访问令牌（电影 / 剧集库需要）。网页端设置里填写的令牌优先                         |
| —                        | `YINGBOX_OPENSUBTITLES_KEY`               | 无                            | OpenSubtitles API key（按文件哈希辅助识别，可选）                                        |
| —                        | `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | 无                            | 出网代理，见下文                                                                         |
| —                        | `NODE_USE_ENV_PROXY`                      | 无                            | 设为 `1` 时 Node fetch 才读上面三个代理变量                                              |
| —                        | `YINGBOX_ONLINE`                          | `on`                          | `off` 关闭在线板块（不起引擎、不开播放代理），见「在线播放」                             |
| —                        | `YINGBOX_DOWNLOAD_DIR`                    | `<数据目录>/downloads`        | 在线板块的下载目录                                                                       |
| —                        | `YINGBOX_BROWSER`                         | 无                            | `chromium:<路径>`：用系统 Chromium 代抓被 Cloudflare 挑战拦下的页面                      |
| —                        | `YINGBOX_STREAM_ALLOW_PRIVATE`            | 无                            | 播放代理放行的内网目标：主机名、IP 或 IPv4 网段，逗号分隔                                |
| —                        | `YINGBOX_ENGINE_IDLE`                     | `300`（秒）                   | 在线引擎空闲多久退出；`0` 不退出                                                         |

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

浏览器打开日志里的 `http://127.0.0.1:31480/?token=…`。默认只监听 `127.0.0.1`，同一台机器以外访问不到；要给局域网用，加 `--host 0.0.0.0`，并用 `YINGBOX_SERVER_TOKEN` 设一个至少 24 个字符的随机令牌（不设服务拒绝启动）。

需要 Node 22+（用到 `node:sqlite`；`--disable-warning=ExperimentalWarning` 只是去掉它的实验提示）。

### 开发

```bash
pnpm dev:server     # tsx watch，改 src/server 或片库核心后自动重启（端口 31480）
pnpm dev:web        # vite，/api 与 /media 代理到 YINGBOX_SERVER_TARGET（默认 http://127.0.0.1:31480）
```

`dev:web` 经代理访问时，服务不托管页面，地址栏的 `?token=` 由网页端自己换成 Cookie。

检查脚本：

- `pnpm smoke:server`：起一个临时服务，出网用离线夹具（`scripts/smoke/fixture-fetch.mjs`），走一遍 登录 → 目录浏览 → SSE → 建库 → 识别 → 详情 → 图片 → Range 流 → 根目录限制 → 托管网页。
- `node scripts/smoke-server.mjs --online`：同上，但用真实网络，看元数据站点在当前网络下是否可达（被 Cloudflare 拦下属正常，按主机熔断后跳过）。
- `node scripts/web-e2e.mjs`：用 Playwright 驱动网页端完整走一遍（需先 `build:web`、`build:server`；Playwright 不是项目依赖，用 `PLAYWRIGHT_MODULE` 指向自备的模块）。在本地手动运行。

### NAS（Docker）

仓库根目录的 `Dockerfile`（多阶段、固定基础镜像、入口降权、健康检查）和 `docker-compose.yml`（默认只映射到宿主 127.0.0.1、令牌必填、片库只读）。
步骤、目录映射、群晖 / 威联通 / Unraid、反向代理与 HTTPS、CloudDrive2 网盘见 [在 NAS 上用 Docker 部署](deploy/nas.md)；决策见 [ADR-0010](adr/0010-docker-nas-deploy.md)。

## 自动入库

新文件从出现到可以播放的完整链路（桌面版与片库服务相同，都在 `src/main/library`）：

```
发现变化 ──▶ 增量扫描 ──▶ 写入稳定？──否──▶ 这一轮不收，过一会儿定向复扫
 事件 / 定时     目录 mtime 短路     │是
                                     ▼
                            入库（解析片名、分组）──▶ 自动识别（库设置「自动识别」）
                                                       │ TMDB 库要令牌
                                                       ▼
                               自动整理（库设置「自动整理」+ 全局「允许整理文件」）
                                                       ▼
                               自动写出 NFO 与图片（库设置「自动写出」，可跟随全局）
```

### 发现变化

两条通道，正确性只靠第二条：

1. **文件系统事件**（`fs.watch` 递归）：秒级入库。Windows / macOS 一个句柄管整棵树；Linux 上每个目录占一个 inotify watch。
2. **定时增量扫描**（默认每 5 分钟）：对整库做一次增量扫描，目录 mtime 没变就跳过，无变化时只 `stat` 目录、不读文件、不写数据库。
   事件丢失（网络盘、事件缓冲溢出、休眠唤醒）都由它兜住。启动时也会立即补扫一次，收进停机期间新增的文件。

存储为「网盘」的库（库设置里选「网盘」，或「自动」判为下表的网络盘 / 挂载盘）两条都不用，只按变更通知（`notifyChanges`，见 [网盘模式说明](library-cloud-mode.md)）与手动扫描入库，下面的模式只管本地盘库。

`YINGBOX_WATCH`（桌面版固定为 `auto`）：

| 模式     | 行为                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`   | 本地盘：事件 + 定时扫描。NFS / SMB(CIFS) / FUSE（rclone、sshfs、mergerfs）/ 9p / virtiofs（Linux 按 `statfs` 判断）：存储「自动」时按网盘处理；改选「本地盘」后只用定时扫描 |
| `events` | 总是尝试事件 + 定时扫描。确认网络盘事件可用（比如文件都由 NAS 本机写入）时用                                                                                                |
| `poll`   | 只用定时扫描。inotify 不可靠的环境（Docker Desktop for Mac / Windows 的目录共享、WSL2）可以直接选它                                                                         |
| `off`    | 不监控，只在手动扫描时入库                                                                                                                                                  |

事件启动失败或运行中出错时，这个库自动降级为定时扫描并在日志里写明原因，例如：

- `inotify 监听数达到上限`（`ENOSPC`）：目录很多时会碰到。在**宿主机**上调大（容器共用宿主机的限制）：
  `sudo sysctl fs.inotify.max_user_watches=524288`（写进 `/etc/sysctl.conf` 永久生效）。不调也能用，只是新文件要等下一次定时扫描。
- `... 在 nfs 文件系统上，收不到别的机器写入的事件`：正常现象，靠定时扫描。想更快入库就把 `YINGBOX_SCAN_INTERVAL` 调小（比如 `60`）；
  目录很多的网络盘上每次扫描要 `stat` 全部目录，间隔不宜太短。

### 写入稳定判定

正在复制 / 下载的视频不会被拿去刮削和整理：扫描看到的新视频（或大小变了的视频）要**两次观察间隔不少于 `YINGBOX_SETTLE_SECONDS`、大小与 mtime 都没变**才入库；
没稳定的先跳过，过一会儿只对它所在的目录复扫。只看 mtime 不够——SMB 客户端、`cp -p`、部分下载器会先设好 mtime 再慢慢写内容。

- 媒体库**第一次扫描**时，磁盘上的存量文件只要 mtime 早于判定时间就直接收，不用等。
- 同盘改名 / 移动是原子的，按指纹识别为移动的文件不等待，原来的匹配跟着走。
- 下载器的临时文件（`.part`、`.!qB`、`.crdownload`）本来就不是视频扩展名，不会被收录；下载完改名时按新文件处理。

### 库级自动化

每个文件夹（媒体库）单独设置，在「媒体库设置 → 自动入库」里改，桌面版和网页端一样（方法 `updateLibrary`，添加时也可以在 `addLibrary` 里带 `automation`）：

| 设置       | 默认     | 说明                                                                                                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 存储       | 自动     | 自动：UNC 路径或 NFS / SMB / FUSE 等挂载判为网盘，其余按本地盘。网盘不监听、不定时扫描、不读视频内容，只按变更通知与手动扫描入库；要轮询就选「本地盘」 |
| 监控文件夹 | 开       | 关闭后这个库不监听、不定时扫描，只在手动扫描时入库                                                                                                     |
| 自动识别   | 开       | 新入库 / 文件变化的条目自动识别；TMDB 库需要令牌                                                                                                       |
| 自动写出   | 跟随全局 | 识别后写 NFO 与图片。「跟随全局」用写出设置里的「识别后自动写出」，也可以对这个库单独开 / 关                                                           |
| 自动整理   | 关       | 识别后按模板改名移动。只整理自动匹配 / 已锁定的条目，有冲突的项不动；每次记一个批次，可在设置里撤销。还要求写出设置里「允许整理文件」开启              |

同时开了自动整理和自动写出时，先整理、再写出，NFO 与图片直接写到最终位置。

代码里这条链写在各后台任务定义的后继（`followups`）里，由任务队列统一派发：父任务成功才派（自动整理成功或失败都派写出），取消不派，同一任务类型 + 目标已排队就合并；规则与当前链见 [ADR-0012](adr/0012-library-job-followups.md)。

### Docker / NAS 建议

- 媒体目录是宿主机本地盘（群晖 / 威联通的存储池）并 bind mount 进容器：默认 `auto` 即可，事件可用。
- 媒体目录是挂进容器的 NFS / SMB 网络盘：存储「自动」会判为网盘、不再定时扫描。靠轮询入库就把这些库的存储改成「本地盘」（只用定时扫描），可以把 `YINGBOX_SCAN_INTERVAL` 调到 `60`–`120`。
- 下载器和片库服务在同一台 NAS 上、下载完直接移进媒体目录：同盘移动是原子改名，几秒内入库；跨盘复制会等写入稳定后入库。

## 在线播放

网页端的在线板块（CMS / CatSpider 搜索与详情、播放、测速、豆瓣浏览、AV、番号下载）由服务托管的在线引擎提供（ADR-0019）：

```
浏览器                                   片库服务                               引擎子进程（out/server/engine.js）
features/online|av|download              src/server/online                       src/engine/node.ts → boot.ts
  api 入口 ── engine-bridge.ts ──POST──▶ /api/engine/rpc（契约 parse 校验）──▶ EngineHost / UtilityHost（fork，线协议）
            ◀──────────── SSE ───────── /api/engine/events ◀────────────── 事件（download:changed …）
  播放器 art-core ── webPlayableUrl ──▶ /api/stream?src=…（鉴权、防 SSRF、Referer、m3u8 改写、Range）──▶ 源站
```

- **同一份契约**：通道名、参数元组、返回值与桌面端 `window.api.online|av|download` 一字不差（线格式 `src/shared/engine-http.ts`）。网页端按契约生成同形状的对象，界面代码不区分 IPC 与 HTTP。
- **引擎是子进程**：`child_process.fork` 起 `engine.js`，按需启动、崩溃重启、空闲 5 分钟退出（`YINGBOX_ENGINE_IDLE`），与桌面端同一个 `EngineHost`；队列里有没下完的下载时，服务启动就把引擎拉起来续传。
- **宿主能力**：下载目录取 `YINGBOX_DOWNLOAD_DIR`；TMDB 令牌取网页端媒体库设置里保存的那个（再退回 `YINGBOX_TMDB_TOKEN`）；浏览器代抓见下文。
- **出网**：引擎用 Node fetch（undici），SSRF 防护与逐跳重定向和桌面端一样；代理与片库相同（`HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`，子进程继承）。`YINGBOX_FETCH`（curl-impersonate）只管片库刮削，不管引擎。

### 播放代理

网页端播放第三方地址时，播放器把跨源的 http(s) 地址换成 `/api/stream?src=<地址>`（片库自己的 `/media/files` 不换），播放进度与历史仍记原地址。

- 要令牌（Cookie / Bearer），和其它 `/api` 一样。
- 只转发无凭据的 http/https **公网**地址，每一跳重定向都校验；回环、内网、链路本地、`localhost` 一律 403。局域网里的源（自建 CMS、媒体服务器）要显式放行：`YINGBOX_STREAM_ALLOW_PRIVATE=nas.lan,192.168.1.0/24`。
- 透传 `Range`（拖动、mp4 直链）；按源注入防盗链 `Referer`（与桌面端 `media-headers.ts` 同一份名单 `src/shared/net/media-referer.ts`），UA 用 Chrome 的；不带浏览器 Cookie。
- 正文以 `#EXTM3U` 开头的就当清单（不看后缀和类型），地址行与 `URI="…"`（密钥、初始化段、子清单、音轨）全部改写成代理地址，相对地址按跟随重定向后的地址解析；iOS Safari 的原生 HLS 也能播。清单上限 8 MB。
- 所有视频流量都经过 NAS：带宽和 CPU 由它承担；放在反向代理后面时关掉缓冲、调大超时（见 nas.md）。

### 浏览器代抓（可选）

一些源站在 Cloudflare 后面，Node fetch 的 TLS 指纹不是浏览器，常被挑战页拦下。桌面端用隐藏的 Chromium 窗口代抓；服务端默认**没有**，这时 `browserFetch` 返回空串，引擎按「挑战没过」降级：插件源记熔断并在源列表里标成不可用，MissAV 提示验证未通过。

要开启：

1. 装 Chromium 与 `playwright-core`（它没有依赖）。Docker 用构建参数 `WITH_CHROMIUM=1`（同时装 ffmpeg 与中文字体）；直接跑 Node 时在服务目录里 `pnpm add playwright-core`（或 `npm pack playwright-core` 解包到 `node_modules/playwright-core`）。
2. 设 `YINGBOX_BROWSER=chromium:/usr/bin/chromium`（填 Chromium 可执行文件路径）。启动日志会写「浏览器代抓 Chromium（…）」。

无头 Chromium 只能过自动通过的挑战，过不了要人工点的验证；与桌面端一样串行、按主机熔断、硬封锁 30 分钟内不再试，用户目录在 `<数据目录>/engine/browser`（cf_clearance 跨请求保留），空闲 5 分钟关掉浏览器。

### 下载

番号下载在服务端执行，文件落在 `YINGBOX_DOWNLOAD_DIR`（每部一个子文件夹）。PATH 上有 `ffmpeg` 时下完转成 mp4，没有就保留 `.ts`。网页端设置里不能改下载目录，在服务端改环境变量。可以把下载目录设成某个媒体库目录的子文件夹，下完由目录监控自动入库。

## 代理

服务端的 Node fetch（undici）默认**不读**代理环境变量。需要代理才能访问 TMDB 等元数据站点时：

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

部分刮削站点用 Cloudflare 按 TLS / HTTP2 指纹拦截非浏览器客户端。桌面版用的是 Chromium 网络栈，不受影响；服务端的 Node fetch 指纹和浏览器不同，可能被拦。
这时可以改用 [curl-impersonate](https://github.com/lwthiker/curl-impersonate)（或其维护分支），它的包装脚本与普通 curl 命令行兼容：

```bash
# 例：装好后用 Chrome 指纹的包装脚本
node out/server/server.js --fetch curl:/usr/local/bin/curl_chrome116
# 或
YINGBOX_FETCH=curl:/usr/local/bin/curl_chrome116 pnpm start:server
```

- `--fetch curl` 用系统 curl（指纹和 Node 差不多，主要用来验证接线）。
- 一次请求一个 curl 进程，超时 30 秒、响应体上限 32 MB；取消请求会结束子进程。
- 不管用哪种实现，被 Cloudflare 硬封锁时都会由刮削源的按主机熔断跳过，不会反复请求。
- Docker 镜像里没有 curl-impersonate；需要的话基于镜像加一层安装，再设 `YINGBOX_FETCH`。
- `module:<路径>`：自定义模块，导出 `createFetch()`（返回 `HttpFetch`），用于接其它实现或离线回放。

## 网页端能做什么

能做：

- 登录片库服务（令牌一次，之后靠 Cookie）。
- 在媒体根目录内浏览文件夹，添加电影 / 剧集库；删除库、扫描、识别全部、刷新元数据。
- 海报墙（排序、筛选、搜索、分库）、待确认队列、修正匹配、锁定。后台进度与条目变化经 SSE 实时刷新。
- 条目详情；在页内 `<video>` 播放（分段电影、一季的集按顺序连播），视频经 Range 流拖动。
- 媒体库设置里填写 TMDB 令牌（存在服务端）。
- 写出 NFO / 图片、整理改名：在服务端执行，需要媒体目录可写。
- 按文件夹设置自动入库（监控、自动识别 / 刮削、自动写出、自动整理），见「自动入库」。

不能做（或受限）：

- 浏览器解码能力有限：MP4 / WebM 里的 H.264、VP9、AV1 一般没问题；MKV、HEVC、DTS 音轨等视浏览器而定，播不了时播放器显示错误面板（可改用桌面版）。没有服务端转码。
- 没有 mpv、外挂字幕自动挂载。
- 只能访问媒体根目录以内的文件夹（服务端强制）。
- 在线板块与下载经服务端引擎（见「在线播放」）；直播、网盘、AI、追更等其它桌面端板块网页端仍不可用。
- 在线源被 Cloudflare 拦下时，没开浏览器代抓就只能标成不可用；开了也过不了需要人工点的验证。
- 网页端只连同源的片库服务，不能在页面里改连其它地址（开发时用 `dev:web` 的代理）。
