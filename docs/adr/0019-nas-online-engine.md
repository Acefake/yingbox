# ADR-0019 NAS 在线播放：片库服务托管在线引擎子进程 + 鉴权的播放代理

- 状态：已采纳（2026-10-26）
- 相关：部分取代 ADR-0010 里「在线 / 下载不在片库服务里」；ADR-0001（两个 utilityProcess 不合并）、ADR-0009（统一线协议）、ADR-0010（NAS / Docker 部署）；说明见 docs/library-server.md「在线播放」、docs/deploy/nas.md「在线播放」

## 背景

网页端（片库服务托管的 dist-web）只有媒体库：在线板块的搜索、解析、测速、豆瓣浏览都在桌面端的引擎 utilityProcess 里（`src/engine`），渲染层只经 IPC 调它，网页端调用时直接报「需要桌面端」。在 NAS 上常驻片库之后，想在手机 / 电视的浏览器里也能用在线板块。

桌面端引擎本身已经和 Electron 基本分开：它只向宿主要三样东西（浏览器代抓 browserFetch、下载目录、TMDB 令牌），其余出网都走 `src/shared/net`。真正卡住网页端的还有两处：浏览器直接播第三方 m3u8 / mp4 会碰到 CORS 与防盗链（桌面端靠 `yingbox-stream://` 自定义协议与 `media-headers.ts` 注入 Referer 解决），以及引擎入口用的是 `electron.net` 与 `process.parentPort`。

## 决策

- **引擎组装与宿主分开**：`src/engine/boot.ts` 注册 online / av / download 三个域；桌面入口 `index.ts`（parentPort + `net.fetch`）与 Node 入口 `node.ts`（`process.send` + Node fetch）只是两层薄壳。构建：`build:server` 多出 `out/server/engine.js`。
- **服务端用 child_process.fork 跑引擎，复用 EngineHost / UtilityHost**：同一套按需启动、崩溃重启（含崩溃守卫）、空闲 5 分钟退出、关停超时 kill；fork 时 `serialization: 'advanced'`（结构化克隆，与 utilityProcess 一致）。不在服务进程里直接跑引擎：插件 QuickJS、下载队列的崩溃与内存不拖累片库，也和桌面端的进程边界一致（ADR-0001）。`forwardTo` 挪到 `main/engine/forward.ts`，`host.ts` 不再沾 Electron。
- **宿主能力在 Node 侧实现**：下载目录 = `YINGBOX_DOWNLOAD_DIR`（默认 `<数据目录>/downloads`，镜像里 `/downloads`）；TMDB 令牌 = 服务密钥文件里网页端保存的那个，再退回环境变量；浏览器代抓可选：`YINGBOX_BROWSER=chromium:<路径>` 时用 playwright-core 驱动系统 Chromium（串行、按主机熔断、硬封锁不重试、持久化用户目录、空闲关闭），没设就返回空串——与桌面端「挑战没过」同一个结果，引擎照常降级。镜像默认不带 Chromium，`WITH_CHROMIUM=1` 构建参数装上。
- **契约不变，换 transport**：`POST /api/engine/rpc { channel, args }` 与 `GET /api/engine/events`（SSE）开放 online / av / download 三个域；服务端用契约自己的 parse 校验参数（与 IPC 边界同一份规则），不合法不转发。网页端 `services/library-server/engine-bridge.ts` 按契约生成与 `window.api.<域>` 同形状的对象，`features/online|av|download` 的 api 入口按有没有 `window.api` 选一个，界面代码不区分 IPC 与 HTTP。
- **播放代理 `GET /api/stream?src=`**：复用桌面端 `proxyStream`（透传 Range、按源注入 Referer、不带浏览器 Cookie、只等响应头超时）；要令牌；只允许无凭据的 http/https 公网目标，每一跳重定向都校验，内网目标要 `YINGBOX_STREAM_ALLOW_PRIVATE` 显式放行（主机名 / IP / IPv4 网段）。清单在服务端改写（按正文 `#EXTM3U` 认，不靠后缀），地址行与 `URI="…"` 全部换成代理地址——iOS Safari 原生 HLS 不经 hls.js，只能靠改清单。网页端在 `art-core` 把跨源地址换成代理地址，调用方、播放进度与历史仍用原地址。
- **设置**：在线板块的配置只走环境变量（`src/server/online/config.ts`），不新增服务端设置存储；网页端的下载目录设置提示去服务端改。

## 后果

- 网页端在线板块（搜索、详情、播放、测速、豆瓣浏览）与 AV、下载可用；下载落在服务端的下载目录。服务启动时队列里有没下完的任务会立即拉起引擎续传。
- 服务端出网是 Node fetch（undici），TLS 指纹不是浏览器：一些在桌面端能直连的站点在 NAS 上会撞 Cloudflare 挑战，没开浏览器代抓时这些源会被标成不可用；开了也只能过无头浏览器能自动过的挑战。
- 播放流量全部经 NAS 转发（带宽、CPU 由 NAS 承担），对外访问时注意反向代理的超时与缓冲（SSE 与长连接视频流）。
- 引擎的出网仍不认 `YINGBOX_FETCH`（curl-impersonate 只用于片库刮削）；需要代理时与片库一样设 `HTTPS_PROXY` + `NODE_USE_ENV_PROXY`，子进程继承环境变量。

## 否决方案

- **在服务进程内直接调用引擎处理函数**：省一个进程，但插件运行时、下载队列的异常与内存会进到片库进程，空闲退出也没了；两种宿主的生命周期规则会分叉。
- **网页端也用 hls.js 自定义加载器逐个请求走代理（桌面端的做法）、服务端不改清单**：iOS Safari 等原生 HLS 播放器用不上；mp4 直链也一样需要代理地址。
- **镜像默认带 Chromium**：多约 1 GB（实测约 950 MB），多数 CMS 源用不上；改成构建参数。
- **把 playwright-core 加进依赖**：会让所有部署都装它，桌面端也被锁文件牵连；它没有依赖，镜像里直接解包即可，运行时按需加载。
