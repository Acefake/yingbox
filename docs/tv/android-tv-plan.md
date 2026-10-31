# 影盒安卓 TV 独立 App 技术方案

日期：2026-10-31。本文只定方案，不包含业务代码。

范围是一台电视或盒子上的单独安装包。安装之后自己完成在线观看、本地与网盘库刮削、播放、直播。不连接影盒桌面端，不连接影盒 NAS / 片库服务（`src/server`），也不连接已经退出在线链路的 Go 后端。用户自己填写的 SMB、WebDAV、115 由这个 App 直接访问，那是片源，不是去连影盒服务。

桌面与网页现在的进程模型（渲染进程、utility 引擎、`src/server` 上 fork 的同一套引擎）不搬到电视上。电视上是一个前台应用加少量后台任务。

## 1. 结论

**路线：Kotlin + Jetpack Compose for TV，播放默认 Media3（ExoPlayer）。** 规则与桌面共用规格和测试数据，实现用 Kotlin 重写。CatSpider 用 QuickJS（JNI）按 ADR-0014 的限额重做宿主，不把现有 Vue 装进 WebView，也不把桌面「杜比视界 P5 交给 mpv，不行就 libplacebo 转码」原样搬过来。

**复杂度：高。** 四块里，CMS 字段解析、文件名识别、NFO、直播 M3U / XMLTV 已有纯函数和测试，可以对照着移植。真正要单独验证的是两件事：电视芯片上的 4K / HDR / 杜比视界，以及 CatSpider 的 HTML 宿主和 Cloudflare。SMB、115 在仓库里没有可以编译进安卓的现成客户端。

**工期（粗估）。** 按一名熟悉本仓库的 Android 工程师计，不含多机型认证和商店上架。数字是量级，不是排期承诺。

| 阶段                         | 交付                                       | 粗估            |
| ---------------------------- | ------------------------------------------ | --------------- |
| MVP：阶段 1–2                | 遥控器壳、本地文件播放、CMS 在线搜索与播放 | 2.5–3.5 人月    |
| 四块能用：再加阶段 3–5       | 海报墙与 TMDB 刮削、CatSpider、直播、USB   | 再 5–7 人月     |
| 补齐片源与特效字幕：阶段 6–7 | SMB、WebDAV、115、可选 libmpv              | 再 2.5–3.5 人月 |

四块到「日常能看」大约 8–11 人月。阶段 7 可以砍，不影响前六段的验收。播放器必须最先做：后面的在线、片库、直播都坐在它上面。

首版明确不做（仓库里有代码，但不在这四块里）：

- 豆瓣首页、片单、预告（`src/engine/online/` 下的 `douban-*.ts`，渲染层 `src/renderer/src/features/online` 的首页货架）
- 下载队列（`src/engine/download`）
- 番号库与 JAV 多站刮削（`src/main/library/providers/jav`）
- 按画面搜（`src/main/library/visual`，依赖 onnxruntime）
- 弹幕、AI 字幕、问剧情
- 与桌面或 NAS 同步进度、入库推送
- 桌面那条 libplacebo 杜比视界重建（`src/main/dolby-vision/`）

## 2. 技术选型

### 2.1 应用框架

| 方案                                 | 和现有代码的关系                                       | 遥控器                                                                                           | 播放器上限                                                                                     | 判断     |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| Kotlin + Compose for TV              | UI 重写。纯规则对照 `src/shared` 与渲染层 `utils` 重写 | `androidx.tv` 的焦点体系就是为方向键做的                                                         | Media3 直接接解码器，HDR / 杜比视界走芯片能力                                                  | **采用** |
| Flutter                              | UI 与业务都重写，Dart 吃不到现有 TS                    | 电视焦点靠社区控件，没有官方 TV Material                                                         | 播放插件要么包一层 libmpv，要么再桥 Media3，两条引擎都要自己接                                 | 不采用   |
| React Native（含 react-native-tvos） | 业务重写。社区 TV 分支跟不上主线                       | 焦点模型是手机那套改出来的                                                                       | 原生播放器要写原生模块，和直接写 Kotlin 的工作量叠在一起                                       | 不采用   |
| WebView 装现有 Vue                   | 页面能复用 `src/renderer`                              | 现有交互是键鼠和 YouTube 式快捷键（`src/renderer/src/features/player/hotkeys/`），焦点会掉进网页 | 播放核是 Artplayer + hls.js，也就是桌面内置播放器。ADR-0016 写明 Chromium 解不了杜比视界增强层 | 不采用   |

WebView 套壳看起来能少写界面，过不了这次的播放要求。桌面内置播放器只能稳定播 HLS 和 MP4 / WebM；FLV、裸 TS、RTMP、RTSP、UDP 交给外部 mpv（`src/shared/iptv/stream-kind.ts` 文件头注释）。杜比视界 Profile 5 没有 HDR10 兼容基础层，内置直接放会偏色（`src/shared/video-range.ts` 的 `needsDvColorFix`）。桌面的补救是主进程用 ffmpeg libplacebo 把片子转成 1080p 的本机 HLS（ADR-0017，`src/main/dolby-vision/filters.ts` 里软件编码高度上限 1080）。电视盒子的 CPU / GPU 和内存扛不住这条转码链，系统 WebView 的版本还经常停在旧 Android 上。

Flutter 和 React Native 都要重写业务，又多一层框架。播放、存储权限、杜比视界隧道模式最后仍要落到 Kotlin / NDK。Compose for TV 少这一层。

### 2.2 播放内核

桌面是双引擎：内置 Artplayer + hls.js，外部 mpv 进程（`src/main/mpv-player.ts`，设置文案在 `src/renderer/src/features/settings/sections/PlayerSettings.vue`）。分流在 `src/renderer/src/features/player/utils/playback-route.ts`：P5（以及兼容号为 0 且不是 Profile 7 的其它 profile）优先 mpv。这个「谁负责杜比视界」的分工在安卓上要反过来，见下表。

| 内核               | 4K HEVC 硬解                                                      | HDR10 / HLG                                                  | 杜比视界                                                                                                                                                         | ASS                                                                                                 | 多音轨                                                                                                       | 电视盒子上的判断                                                                                                                 |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Media3 / ExoPlayer | 走 MediaCodec。芯片宣称支持 HEVC 时，4K 是它的主路径              | 能把 PQ / HLG 的元数据交到 HDMI，显示器和系统开了 HDR 就能出 | 认证过的 Android TV 上，`video/dolby-vision` 解码器可以硬解 Profile 5 / 8，通常要开隧道模式。Profile 7 的增强层多数设备只剩基础层（有 HDR10 基础层时颜色是对的） | 字幕视图能显示对白，不跑 libass。位置、字体、特效会丢，和桌面 `assToVtt` 去掉 `{\...}` 的结果同一档 | `Tracks` 可以切 MKV / MP4 / HLS 音轨。比桌面内置播放器宽：ADR-0016 写明本地多音轨留给 mpv，内置只做 HLS 音轨 | **默认引擎**                                                                                                                     |
| libmpv-android     | `hwdec=mediacodec` 能硬解 HEVC。杜比视界隧道模式不如 ExoPlayer 稳 | 硬解 HDR10 可以，色调映射取决于这版 mpv 的 VO                | 安卓上的 mediacodec 路径对 Profile 5 的对接不完整，不能当成认证设备上的杜比视界播放器                                                                            | libass，特效字幕这档只有它能做                                                                      | 完整                                                                                                         | **可选模块**，给 ASS 和 Media3 打不开的封装，不负责杜比视界                                                                      |
| IJKPlayer          | 基于多年前的 ffmpeg 分支，没有现成的 HDR 元数据通路               | 没有可靠实现                                                 | 没有                                                                                                                                                             | 不完整                                                                                              | 有基础切换                                                                                                   | 不采用。上游停更，接不了现在的电视接口                                                                                           |
| libVLC             | 封装覆盖面大，HTTP-TS、FLV、RTSP 经验多                           | 有 HDR10，设备差异大                                         | 安卓版以基础层或色调映射为主，不是认证设备那条杜比视界硬解                                                                                                       | libass                                                                                              | 有                                                                                                           | 和 libmpv 抢同一个「补充引擎」位置。默认包不放。真要补直播冷门协议时二选一，优先评估 libmpv，因为桌面已经有 mpv 的发行与许可记录 |

芯片差异要写进播放器，不能写成「支持杜比视界」一句话：

- **认证 Android TV / Google TV**（Shield、Chromecast with Google TV、部分索尼、飞利浦）：`Display.HdrCapabilities` 里有 `HDR_TYPE_DOLBY_VISION`，解码器列表里有 `video/dolby-vision`。Profile 5 走隧道硬解。这是桌面 Chromium 做不到、桌面靠 mpv 或转码才做到的那一档。
- **未认证的晶晨、瑞芯微、联发科盒子**：宣传页写杜比视界，系统播放器可能走厂商私有通道。MediaCodec 可能没有 `video/dolby-vision`，或者有解码器但颜色不对。应用探测能力，探测不到就按 HDR10 基础层播放；Profile 5 显示和网页端同一句提示（颜色可能不正确）。不做软件转码。
- **HDR10 / HLG**：Media3 的常规路径。桌面内置播放器对这两档本来就是交给 Chromium（ADR-0016），电视上改为交给芯片，前提是系统打开了 HDR、HDMI 链路完整。
- **1GB 内存的低端盒子**：默认引擎只留 Media3。libmpv 进程或 so 的常驻内存不适合这个档位。扫描和图片缓存要单独降档，见第 6 节。

桌面保持应用本体 MIT，是因为 mpv 以独立进程使用，许可分开记（`docs/release-licenses.md`）。安卓上把 libmpv 链进同一个进程，组合作品会带上 GPL。默认安装包只含 Media3。libmpv 若做，做成可单独安装的模块，并按 `docs/release-licenses.md` 的方式提供对应源码。VLC 同样是 GPL，同样不进默认包。

音频直通（TrueHD、DTS-HD MA）取决于 HDMI 接收端和系统是否开放直通，Media3 只在设备允许时做直通。方案里把它写成设备能力，不写成播放器缺陷。

### 2.3 其它运行时

| 用途       | 选择                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP       | OkHttp。桌面在线出网在引擎的 `NetClient`（`src/shared/net`），电视上没有浏览器跨域，不再做 `yingbox-stream://` 那层协议。防盗链要的 UA / Referer 仍要带，规则在 `src/shared/net/stream-headers.ts`、`src/shared/net/media-referer.ts` |
| 结构化存储 | SQLDelight（SQLite）。桌面片库是引擎进程里的 `node:sqlite`，文件在 `userData/library/library.db`，迁移到 v12（`src/main/library/db/migrations.ts`）。电视用自己的库文件和版本号，不打开桌面那份 db                                    |
| 图片       | Coil，按海报墙格子的尺寸解码。不移植主进程 `nativeImage` + wasm libwebp 缩略图（`src/main/thumbnails/`）                                                                                                                              |
| 插件 JS    | QuickJS JNI。见第 3.2 节                                                                                                                                                                                                              |
| 后台刮削   | 前台服务 + 可取消的协程。桌面片库是 utilityProcess（`src/main/library/engine/entry.ts`），电视上没有这层进程                                                                                                                          |

## 3. 逐模块移植

原则：纯规则以现有测试为契约，在 Kotlin 里重写，并用同一份夹具对拍。依赖 Node、Electron、`node:sqlite`、ffmpeg 进程的部分按电视环境重写。不在安卓上跑 electron-vite 的产物。

### 3.1 在线观看：CMS

现状：

- 内置站点表是仓库根目录的 `cms-sites.json`（`name` + `api.php/provide/vod`）。渲染层在 `src/renderer/src/features/online/composables/cms-sites.ts` 引入。自定义站点在 localStorage。
- 订阅解析在 `src/renderer/src/features/online/utils/subscription.ts`：接受 LunaTV 的 `api_site` 或通用 `sites`，只保留 URL 匹配 `api.php/provide/vod` 或 `api/json.php` 的条目，丢掉 `is_adult === true`。测试在 `tests/online-subscription.test.ts`。
- 搜索、详情的 HTTP 经引擎 `online.getJson`（`src/engine/online/index.ts`），渲染层并发 6 路（`src/renderer/src/features/online/composables/use-online-search.ts`）。
- 播放地址解析在 `src/renderer/src/features/online/utils/vod-payload.ts` 的 `parseCmsGroups`：`vod_play_from` / `vod_play_url`，线路 `$$$`，集 `#`，名称和地址 `$`。测试在 `tests/online-rules.test.ts`。
- 健康度在 `src/renderer/src/features/online/utils/cms-health.ts`：按 browse / search / detail 记失败，连续失败进入冷却。这是渲染层规则，不是 Go 服务。
- 非直链页面由引擎 `online.resolvePage` 从 HTML 里抽 m3u8（`src/engine/online/index.ts`）。直链判断在 `src/renderer/src/features/online/utils/play-source.ts`（扩展名 m3u8 / mp4 / flv）。

移植：

| 部分                                     | 做法                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `parseCmsGroups`、订阅清洗、健康度计数   | Kotlin 重写。把 `tests/online-rules.test.ts`、`tests/online-subscription.test.ts` 的输入输出导出成 JSON 夹具，两端对拍 |
| `cms-sites.json`、订阅 URL               | 打进 assets。用户增删源存在 DataStore                                                                                  |
| 拉 JSON、详情、并发                      | OkHttp 重写。电视默认并发 3，低于桌面的 6                                                                              |
| 从详情页 HTML 抽 m3u8                    | 重写 `resolvePage` 那一小段正则 / 扫描，保持「抽到的是媒体地址才交给播放器」                                           |
| `yingbox-stream://` 与网页 `/api/stream` | 不移植协议。Media3 的 OkHttp 数据源在清单和分片上带同一组 UA / Referer。相对分片地址由播放器自己解析                   |

CMS 不需要 QuickJS。它可以在插件运行时之前交付。

### 3.2 在线观看：CatSpider / QuickJS

现状（ADR-0014，`src/engine/online/`）：

- 每次动作新建一个 QuickJS WASM 上下文（`plugin-runtime.ts`，依赖 `quickjs-emscripten` 0.32.0）。内存 128MiB，栈 512KiB，宿主缓冲累计 32MiB，对象编号最多 5 万，总时长 30 秒。
- CryptoJS 在解释器里面跑，源文件是依赖包里的 `crypto-js.js`（`plugin-runtime.ts` 读文件注入）。
- 宿主桥只传 JSON 和不透明对象编号。HTML 由宿主的 cheerio `load` 提供（`catspider.ts` 的 `createCheerio` / `$html`），不把 cheerio 放进解释器。
- 动作：`getConfig`、`search`、`getCards`、`getTracks`、`getPlayinfo`（`src/shared/contract/online.ts`）。旧 `parse` 在引擎里当作 `search`。
- 内置站点在 `src/engine/online/vod-sites.json`：`type: 3`，`api` 是插件 id，`ext` 是脚本 URL，可选 `patch` 字符串替换（`applyPatch`）。
- 宿主 API：`$fetch` / `.get` / `.post`、`$cache`、`$utils.toast*`、`$utils.openSafari`（带 UA 的 GET）、`loadJSEncrypt`、受限 `Buffer`、`argsify` / `jsonify`、`console`。
- `loadJSEncrypt` 用 Node `publicEncrypt` / `privateDecrypt`，填充 PKCS#1 v1.5（`catspider.ts`）。注释写明私钥也可以加密，和 JSEncrypt 的行为对齐。
- `Buffer.from` / `alloc` 上限 4MiB。
- GET 且没有 body 时，直连失败或页面被 `classifyPage` 判为挑战，才调用 `browserFetch`。POST 不走代抓。硬封锁直接熔断，不代抓（`catspider.ts` 的 `makeFetch`，分类在 `src/shared/net/cf-page.ts`）。
- 熔断键是主机 + 用途（search / browse），连续 3 次失败，冷却 30 分钟，桌面落盘 `userData/online/breaker.json`（ADR-0004，`breaker-store.ts`）。
- 桌面代抓是主进程隐藏 Chromium 窗口，通过之后 25 分钟内用同一 partition 的 `session.fetch`（ADR-0005）。NAS 上没有配置 `YINGBOX_BROWSER` 时，代抓返回空串，效果和挑战失败一样（ADR-0019）。
- 插件源码缓存 6 小时（`plugin-cache.ts`），`$cache` 按脚本 URL 隔离、30 天、单条 256KB（`plugin-storage.ts`）。

**QuickJS，不用 J2V8。** J2V8 已停更，V8 的体积和基线内存不适合 1–2GB 的盒子，也没有和 ADR-0014 相同的内存 / 中断限额。QuickJS 和现在的解释器是同一家族，限额可以按同样的数字做。Javet（仍在维护的 V8 嵌入）同样偏重，不作为宿主。

电视上的宿主桥用 Kotlin 重写，解释器里继续注入同一份 `crypto-js.js`（把版本钉死，不跟 `^4.2.0` 浮动）。对应关系：

| 桌面宿主                  | 电视                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cheerio `load` 与 `$html` | 先做一次探针：用内置 `src/engine/online/vod-sites.json` 的脚本跑 search / getTracks，记录真实碰到的 cheerio 调用，再用 Jsoup 补这一子集。不承诺 cheerio 全 API |
| Node RSA PKCS#1           | `Cipher` 的 `RSA/ECB/PKCS1Padding`，公钥加密、私钥解密，并保留「私钥加密」这条 JSEncrypt 兼容                                                                  |
| 受限 Buffer               | Kotlin 实现同样的 4MiB 上限                                                                                                                                    |
| `$fetch` → `NetClient`    | OkHttp。插件请求继续只允许公网目标，规则对照 `src/shared/net` 的 SSRF 检查。用户配置的 SMB / 直播内网地址不走这条插件通道                                      |
| `$cache`、脚本缓存、patch | 应用私有目录，数字与桌面一致（6 小时源码、30 天 KV、256KB）                                                                                                    |
| 熔断                      | DataStore 里同一套键和 30 分钟冷却。测试对照 `tests/breaker-scope.test.ts`                                                                                     |
| `browserFetch`            | 见第 6 节。默认预期对齐 NAS 的 Node 路径：挑战页失败就记熔断，而不是对齐桌面 Chromium                                                                          |

1GB 设备上把解释器内存上限从 128MiB 降到 48MiB，超时仍是 30 秒。能在桌面跑完、内存曲线很低的插件不受影响；顶满 128MiB 的插件在低端盒子上失败并提示，避免把系统杀进程。

不采用的做法：用 WebView 当插件引擎（隔离比 ADR-0014 弱，页面还能碰到 DOM 和任意网络）；把 `nodejs-mobile` 打进安装包当正式运行时（体积和内存不适合盒子）。阶段 4 如果 Jsoup 子集盖不住真实插件，再单独立项评估「只给插件用的 Node 进程」，那是后续决策，不写进默认架构。

### 3.3 片库刮削

现状的主链在 `src/main/library`，渲染海报墙在 `src/renderer/src/features/library/wall/PosterWall.vue`。旧的 Movie / TV 页面已经不在这条链上。

| 环节                    | 现有位置                                                                                                                                                                                                   | 电视上                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件名 → 电影 / 季 / 集 | `src/shared/library/parser/`，入口 `parseMediaPath`。季集标记在 `markers.ts`，中文与文件夹回退在 `parse-path.ts`、`cjk.ts`                                                                                 | Kotlin 重写。契约是 `tests/library/golden.test.ts`（不少于 2000 条，夹具在 `tests/fixtures/media-names/`）和 `tests/library/parser.test.ts`。扫描热路径不经过 QuickJS                                                                                                                                                                     |
| 扫目录、增量            | 本地 `src/main/library/scanner/walk.ts`（默认并发 16），WebDAV `src/main/library/scanner/remote-walk.ts`（默认 4，PROPFIND）                                                                               | 按数据源重写。本地 / USB 用 SAF 或可直接读的路径；并发降到 4。不移植 `node:fs` 的 watch                                                                                                                                                                                                                                                   |
| 分组建树                | `src/main/library/catalog/grouping.ts`                                                                                                                                                                     | 对照重写，和解析器夹具一起测                                                                                                                                                                                                                                                                                                              |
| 识别打分、NFO 读取      | 纯规则在 `src/shared/library/identify/`（含 `nfo.ts`、`nfo-details.ts`）。任务编排在 `src/main/library/identify/identify-runner.ts` 以及同目录的 `runner-movie.ts`、`runner-series.ts`、`runner-manual.ts` | 规则用 `tests/library/identify.test.ts`、`tests/library/nfo.test.ts`、`tests/library/nfo-details.test.ts` 对拍。编排和任务队列重写                                                                                                                                                                                                        |
| 绝对集数 → TMDB 季集    | `src/main/library/identify/episode-mapping.ts`：有季号直接对应，特别篇是第 0 季，绝对集数查顺序表                                                                                                          | 连同类型一起重写，行为保持这段注释                                                                                                                                                                                                                                                                                                        |
| TMDB                    | `src/main/library/providers/tmdb/tmdb-provider.ts`。令牌在桌面经 safeStorage 再写入引擎 settings                                                                                                           | OkHttp 调 TMDB v3。令牌放加密 DataStore，只在设置页写入。语言和图片档用 `src/shared/library/scrape-prefs.ts`：`zh-CN` / `zh-TW` / `en-US` / `ja-JP` / `ko-KR`，图片 `w342` / `w780` / `original`，默认海报 w780                                                                                                                           |
| 动态范围                | `src/shared/video-range.ts` 解析 ffprobe：DOVI side data → 杜比视界并记下 profile 与兼容号，否则按 `color_transfer` 分 HDR10 / HLG / SDR。库表列在迁移 v8                                                  | 电视不打包 ffprobe。扫描本地文件时用 Media3 提取器读 MIME 和色彩信息；MP4 / MKV 里的 dovi 配置盒用一个小解析器读 profile 和兼容号，字段语义与 `VideoProbe` 相同。读不到 profile 时，在没有杜比视界解码器的设备上按「需要提示偏色」处理。网盘源沿用桌面：不读视频内容，不做这步探测（ADR-0011，`src/main/library/engine/storage-mode.ts`） |
| NFO 写出                | `src/main/library/writer/nfo/nfo-builder.ts` 生成 Kodi、Jellyfin、Emby 都能读的交集；同目录的 `nfo-merge.ts` 尊重已有锁。远程库禁用写出（`docs/library-webdav.md`）                                        | 只对本地和 U 盘、且目录可写时写出。SMB / WebDAV / 115 的元数据只留在 App 的 SQLite                                                                                                                                                                                                                                                        |
| 海报                    | 引擎下载原图，主进程做 WebP 缩略图。人脸定位在 ADR-0013：启发式是纯 TS，细化用 Chromium FaceDetector，Linux 上本来就没有                                                                                   | Coil 磁盘缓存。人脸定位首版不做                                                                                                                                                                                                                                                                                                           |
| 数据库                  | v12 含 FTS、演员、视觉向量、整理批次、观看进度                                                                                                                                                             | 电视 schema 单独编号，只建这些表：库根、目录、文件（解析结果、时长、动态范围）、条目、文件与条目关系、匹配候选、TMDB 缓存、图片缓存、观看进度、设置。不做演员 FTS、视觉向量、整理撤销                                                                                                                                                     |

桌面「网盘模式」不读旁路 NFO、不算指纹、不探测 HDR（`docs/library-webdav.md`，ADR-0011）。电视保持这个分界：本地和 U 盘可以读旁路 NFO 和文件头；SMB、WebDAV、115 只靠文件名和目录名刮削，播放时再流式打开。

OpenSubtitles 哈希、AI 刮削依赖主进程代办，首版不做。

### 3.4 播放器

现状里要保留的行为，和不要搬的实现：

| 行为           | 现有实现                                                                                                                                                                                          | 电视                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 打开方式       | `openMediaPlayer`（`src/renderer/src/features/player/index.ts`）。桌面是独立窗口（ADR-0018，`src/main/player-window/`），网页是弹窗                                                               | 一个全屏播放 Activity。返回键先关 OSD，再退出并记下进度                                                                                     |
| 续播           | 非片库：localStorage `media_play_progress`。片库：SQLite `watch_progress`（迁移 v9）。写入节流 2 秒（`src/renderer/src/features/player/composables/use-progress-saver.ts` 的 `PERSIST_INTERVAL`） | DataStore + 电视库的进度表。同一套「播了多久算继续、快结束算看完」规则，对照 `src/renderer/src/features/player` 里进度相关纯函数后写成夹具  |
| 倍速           | `src/renderer/src/features/player/hotkeys/hotkey-map.ts` 的 `RATE_STEPS`：0.5、0.75、1、1.25、1.5、2                                                                                              | OSD 菜单用同一组档位                                                                                                                        |
| 外挂字幕       | `src/main/subtitle.ts`：`decodeSubtitleText` 认 BOM、UTF-8、UTF-16，再在 GB18030 和 Big5 之间按常用字打分；`srtToVtt`；`assToVtt` 去掉 `{\...}`、把 `\N` 换成换行                                 | 编码检测和 SRT 解析用 Kotlin 重写并对拍。ASS 在默认引擎里走和 `assToVtt` 相同的纯文本。特效留给可选 libmpv                                  |
| 旁路字幕发现   | `subtitle:find` 只接受 `local://`                                                                                                                                                                 | 本地 / USB 扫同目录 srt / ass。在线播放用播放地址自带的字幕轨；不为在线页面做桌面那套本地字幕 IPC                                           |
| 多音轨         | 内置仅 HLS（`src/renderer/src/features/player/settings-menu/install-menu.ts`）。本地容器在 mpv                                                                                                    | Media3 的音轨选择，HLS 和本地容器都做                                                                                                       |
| 下一集         | 播放列表由详情页 `buildPlaylist` 传入                                                                                                                                                             | OSD 和播完倒计时沿用这个「当前线路一份列表」的数据，倒计时暂停时停表（ADR-0016 的 `skip/` 规则）                                            |
| 杜比视界路由   | `playback-route.ts` + `needsDvColorFix`                                                                                                                                                           | 保留判定函数的语义。动作改为：设备有杜比视界解码器则隧道硬解；没有则 Profile 5 直接播并提示偏色。不启动 `src/main/dolby-vision/` 的转码服务 |
| 本地文件 Range | `src/main/local-media.ts` 的 `local://`                                                                                                                                                           | 本地文件用 `file://` 或 SAF 的文件描述符。不实现 `local://`                                                                                 |
| 在线代理       | 桌面 `yingbox-stream://`，网页 `GET /api/stream`（含 m3u8 改写，`src/server/online/stream/`）                                                                                                     | OkHttp 数据源带 UA / Referer。只有分片主机和清单主机不同、且防盗链认的是页面 Referer 时，才在数据源里改写请求头，不单独起本机 HTTP 服务     |

YouTube 式键位（空格、J / K / L、方向键 5 秒）不映射到遥控器。遥控器的位移见第 5 节，进度跳变用 10 秒，和桌面 J / L 那一档相同。

### 3.5 直播

现状：

- 桌面 IPC：`src/main/ipc/iptv-ipc.ts`（可选本地 m3u 文件）。NAS：`src/server/iptv.ts`，只接受远程 URL，不读服务器磁盘上的任意文件。
- 播放列表解析在 `src/renderer/src/features/live/utils/playlist-parse.ts`，频道头里的 UA / Referer 在 `playlist-headers.ts`。测试：`tests/iptv.test.ts`、`tests/live-stream-headers.test.ts`。
- 格式判定是纯函数 `src/shared/iptv/stream-kind.ts`。内置能播 HLS、MP4 / WebM、音频；FLV、MPEG-TS、DASH、HTML 错误页、以及 `rtmp` / `rtsp` / `rtp` / `udp` 等协议交给 mpv。`/rtp/239...` 这种 udpxy 地址识别为 MPEG-TS。测试：`tests/live-playback.test.ts`。
- 线路失败后的切换在渲染层 `use-live-line.ts` 与 `line-plan.ts`，探测实现在 `src/main/iptv/stream-probe.ts`（读响应头和前 4KB）。
- EPG：`src/shared/iptv/xmltv.ts`，缓存 12 小时（`src/main/iptv/epg-store.ts` 的 `EPG_TTL_MS`），支持 `.xml.gz`。
- 源和收藏在浏览器 localStorage。ADR-0023 明确不在服务端做转码，也不增加 UDP / RTP。

移植：

| 部分                                      | 做法                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| M3U / TVBox 文本、XMLTV、流类型、线路计划 | Kotlin 重写，用上面几份测试导出的夹具对拍                                                                                               |
| 拉列表、拉 EPG、探测前 4KB                | OkHttp。EPG 缓存仍是 12 小时                                                                                                            |
| HLS、MP4、HTTP 上的 MPEG-TS               | Media3 直接播。桌面内置播不了裸 TS，电视默认引擎可以，这是直播体验上的实际差别                                                          |
| FLV、RTSP、UDP、RTP                       | 默认包给出「这条线路需要可选播放器」的说明，不静默失败，也不做 udpxy。和 ADR-0023 的边界一致。可选 libmpv 模块再接这些协议              |
| 用户把直播源指到局域网                    | 允许。这是用户显式添加的地址，与插件 `$fetch` 的公网限制分开，对应 NAS 上 `YINGBOX_STREAM_ALLOW_PRIVATE` 那道开关的「用户自己的源」一侧 |

## 4. 片库数据来源

「不连 NAS」指的是不依赖影盒自己的片库服务。下面的网络位置都由 App 自己登录和列目录。

桌面今天的真实能力：

- 本地盘：`src/main/library/scanner/walk.ts`。
- SMB：没有 SMB 客户端。UNC 或系统已经挂上的 cifs / nfs 会被 `src/main/library/engine/storage-mode.ts` 判成网盘模式，然后仍用操作系统的文件 API 去列。
- WebDAV / Alist：有客户端，路径形如 `yingbox-dav://<源 id>/<远程路径>`，PROPFIND 在 `src/main/library/scanner/remote-walk.ts`，凭据在主进程，播放经主进程带 Range 转发（`docs/library-webdav.md`）。
- 115：桌面片库通常走 CloudDrive2 挂载加变更通知（ADR-0011，`docs/library-cloud-mode.md`），不是在 `src/main/library` 里直接调 115。服务端把 115 收成和 WebDAV 一样的列目录接口：`src/server/netdisk/library.ts` 的 `createPan115Library`，播放用 `Pan115Client.downloadUrl(pickCode)`。登录是扫码状态机（`src/main/pan115/qr-login.ts`），Cookie 在桌面放进 Electron session，在服务端放进 `pan115-cookies.json`（ADR-0020）。
- 没有阿里云盘、百度网盘的专用客户端。

建议支持范围：

| 优先级 | 来源                                                  | 首版行为         | 说明                                                                                                                                                                                                          |
| ------ | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | 盒子本机磁盘、U 盘、移动硬盘                          | 阶段 3 就做      | 电视上的「本地」。用存储访问框架列目录；部分固件列大目录会失败，同一阶段留直接路径（`/storage/...`）作备选。可写目录允许写出 NFO 和图片                                                                       |
| P1     | SMB                                                   | 阶段 6           | 新写的客户端，仓库没有可移植的协议实现。只读列目录和 Range 读。识别只靠文件名。默认不往共享上写 NFO，避免半截写入                                                                                             |
| P2     | WebDAV / Alist                                        | 阶段 6，紧跟 SMB | 按 `docs/library-webdav.md` 的行为移植：PROPFIND、etag 没变就不重列、根目录失败不当成「全删了」、不写出。播放用带凭据的流，不再注册 `yingbox-dav://`                                                          |
| P3     | 115                                                   | 阶段 6 的后半    | 移植扫码登录、按目录 id 分页（`allEntries` 每页 200、最多 500 页）、用 pick code 换播放地址。地址有效期短，在 App 内刷新，不交给系统播放器长期保存。元数据只进 SQLite。不做 CloudDrive2，电视上没有那块挂载盘 |
| 不做   | NFS 客户端、阿里云盘、百度网盘、把影盒 NAS 当远程片库 | —                | 仓库里没有对应客户端；连影盒服务和「App 自己完成」冲突                                                                                                                                                        |

115 的接口和 Cookie 会变，这是维护成本，不是首版能力。P0 不依赖它。

## 5. 遥控器与页面

全局：

- 方向键移动焦点，确定键确认，返回键按层退出。焦点落在可操作项上，页面切换后恢复上次焦点。
- 不依赖悬停。桌面海报墙上的悬停预告不移植。
- 文字按 10 英尺距离取字号，主操作始终在安全区内。
- 返回栈：OSD → 播放页 → 详情或频道列表 → 首页。播放中按返回，先收起 OSD；OSD 已经收起时退出播放并保存进度。

桌面快捷键不照搬。进度条一次跳 10 秒（桌面 J / L 的步长）。倍速只用 `RATE_STEPS`。

### 5.1 页面

**首页**

- 第一行是继续观看，数据来自进度表。没有记录时不留空行，焦点落在下面的入口。
- 四个入口：在线、媒体库、直播、设置。
- 不做豆瓣货架。

**搜索（在线）**

- 屏幕键盘加遥控器输入。提交后同时查已启用的 CMS；CatSpider 在阶段 4 之后加入同一结果列表，并标明来源。
- 结果格子：海报（没有就用标题块）、标题、来源名、健康状态。源在冷却中显示原因，焦点仍可进详情，由用户决定要不要重试。
- 空结果、全部源失败、只有一部分源失败，三种状态分开写清楚。

**详情**

- 左海报，右标题、年份、简介、播放按钮。
- 线路横条用左右键切换。集列表用上下键。集数很多时提供「输入集号」和分页网格，避免一次把几百集画出来。
- 确定键从当前线路的当前集播放，并把该线路的后续集作为播放列表（对应桌面 `buildPlaylist` + `fallbacks` 的数据，换源放进 OSD 而不是详情页的第二套播放器）。

**播放器 OSD**

- 唤起：确定键或上键。数秒无操作后收起，收起后左右键仍跳 10 秒，确定键暂停。
- 上区：标题、集名，以及 HDR10 / HLG / 杜比视界小标（没有探测结果就不显示，和 ADR-0016 一致）。
- 中区：暂停状态。
- 下区：进度条和时间。
- 菜单键打开二级列表，顺序固定：倍速、音轨、字幕、换线路、画面信息。音轨或字幕不足两条时不显示该项。
- 播完或进入片尾：下一集倒计时，暂停时停表。上键可直接下一集。
- 杜比视界 Profile 5 在当前设备不能硬解时，OSD 上方一条说明，不挡进度条。
- 失败：网络超时、403 / 防盗链、解码失败分开提示。在线播放提供「换一条线路」。

**直播**

- 左侧频道分组和列表，右侧画面。上下键换台，确定键打开当前节目与下一节目（EPG 有数据时）。
- 数字键遥控器跳频道；没有数字键时用列表。
- 线路按现有状态机：探测失败或播放失败切下一条，全部失败停在说明上。
- EPG 缺失、列表拉取失败、地址是 RTSP / UDP：各自一句说明。UDP 不在默认包里伪装成正在缓冲。

**媒体库**

- 海报墙网格，左右上下移动。左侧或顶部筛选：电影 / 剧集、全部 / 未匹配。
- 电影确定键进入详情再播放。剧集进入季，再进集。
- 未匹配条目的主操作是「按文件名搜索 TMDB」，对应桌面手动匹配（`src/main/library/identify/runner-manual.ts`）。匹配中显示进度，可返回取消。
- 扫描进行时顶部一条进度，不挡住海报焦点。空库显示「添加文件夹」并跳到设置。

**设置**

- 在线源：内置 CMS、订阅、自定义；阶段 4 起加上 CatSpider 开关和「清除熔断」。
- TMDB 令牌、元数据语言、海报清晰度（`scrape-prefs.ts` 的枚举）。
- 片库位置：本机 / U 盘，阶段 6 加上 SMB、WebDAV、115 扫码。
- 播放：默认倍速、字幕字号、只读的设备能力（HDR10、杜比视界解码器有或没有）。
- 关于：版本。不放桌面那套 mpv 路径配置。

## 6. 风险

**Cloudflare。** 桌面能过 JS 挑战，靠的是 Electron 隐藏窗口和 `session.fetch`（ADR-0005），不是纯 HTTP。ADR-0002 已经否决用 impit 冒充浏览器。电视默认走 OkHttp，和 NAS 的 Node 出网同一档：挑战页过不去。可选的补救是单次、用户看得到的系统 WebView，只用于 GET 挑战，Cookie 留在本应用；硬封锁仍然不弹窗（ADR-0004）。Turnstile 要点选，遥控器经常点不中。产品预期写成：这类源会熔断 30 分钟并可以手动重试，不承诺和桌面 Electron 一样的通过率。不在安装包里带一套 Chromium。

**源失效。** CMS 和插件脚本都会挂。桌面用健康度和熔断把坏源跳过（`src/renderer/src/features/online/utils/cms-health.ts`、`src/engine/online/breaker-store.ts`），订阅清单本身也会换地址。电视沿用同一套状态，并允许关掉单个源。内置 `src/engine/online/vod-sites.json` 的脚本 URL 会过期，更新脚本表走应用更新，不在客户端热改仓库。

**杜比视界。** 认证设备可以硬解 Profile 5，未认证盒子不行。方案用启动时的解码器与 HDR 能力探测分支，而不是用转码补齐。ADR-0017 的重建在桌面上就会把软件编码压到 1080p，一轮临时文件大约几百 MB，还要求 Vulkan 和 libplacebo。低端盒子上这条路径会抢播放内存。Profile 7 的增强层即使在认证设备上也常常只剩 HDR10 基础层，和 ADR-0016「P7 有兼容基础层就内置播」一致，电视上同样不把所有杜比视界都切到第二个引擎。

**ASS。** 默认引擎的效果等同 `assToVtt`：对白在，特效不在。把 libass 放进默认包会带上 GPL 组合和额外内存。特效字幕放在可选模块里，首版文案写明这一档。

**性能和内存。** 桌面本地扫描并发 16、CMS 搜索并发 6、TMDB 请求默认并发 8（`src/main/library/providers/http/provider-http.ts`）。电视降到扫描 4、搜索 3、TMDB 2。海报按格子尺寸解码，磁盘缓存设上限。QuickJS 只在插件动作期间存在，动作结束释放上下文（与 ADR-0014 一致）。1GB 设备检测内存后关闭可选引擎、降低图片缓存、收紧解释器上限。刮削任务可暂停，避免和播放抢解码器。

**存储框架。** 部分电视固件的 SAF 列不出 U 盘深层目录，所以 P0 同时保留直接路径。直接路径在新 Android 上权限更窄，两种都要在目标盒子上试，不能只在模拟器里通过。

**115 与 SMB 是新代码。** 行为可以对照 `createPan115Library` 和 WebDAV 文档，协议栈本身没有可编译的安卓实现。SMB 方言和 115 登录态是阶段 6 的不确定项，所以它们不挡 MVP。

**防盗链。** 去掉浏览器代理之后，漏带 Referer 的症状是 403，看起来像「源坏了」。播放数据源要把解析播放地址时用的 UA / Referer 绑到后续分片上，并用 `tests/live-stream-headers.test.ts` 一类夹具锁住。

## 7. 里程碑

每个阶段结束时，上一阶段的验收仍然成立。真机至少包含一台认证 Android TV 和一台 2GB 左右的未认证盒子；1GB 盒子在阶段 1 和阶段 3 各看一次内存。

### 阶段 1 — 壳和本地播放

- Compose for TV 工程，首页四个入口能聚焦，返回键按层退出。
- 用文件选择器打开一个本地视频，Media3 全屏播放。
- OSD：暂停、10 秒跳转、`RATE_STEPS`、音轨、SRT 外挂（含 GB18030 文件）。
- 退出再进，从进度继续。
- 准备一条 4K HEVC、一条 HDR10、一条杜比视界 Profile 5。认证设备上 HDR10 与 Profile 5 颜色正确；未认证设备上 Profile 5 出现偏色说明且不转码。播 4K 时界面不因为把整帧解成位图而卡死。

### 阶段 2 — CMS 在线（MVP 的另一半）

- 内置 `cms-sites.json` 可搜索、进详情、选集播放。订阅解析与桌面夹具一致。
- HLS 分片带上 UA / Referer，至少一条会校验 Referer 的源能播。
- 一条线路失败时可以换同集的另一条。
- 健康度：把一个源指到拒绝连接的地址，连续失败后搜索跳过它，并可以手动重试。
- `parseCmsGroups` 的夹具测试在 Android 工程里通过。

到这里是 MVP：电视上能看本地文件和 CMS 在线片，遥控器能完成搜索、选集、播放、续播。

### 阶段 3 — 本地 / U 盘刮削和海报墙

- 选择一个含电影和剧集的目录，扫描完成后海报墙出现。文件名夹具（黄金集）在 Android 侧通过。
- 剧集进对季、进对集；绝对集数按 `episode-mapping.ts` 的规则落到 TMDB 的季集。
- 未匹配项可以手动搜 TMDB 并写回。
- 可写目录生成的 NFO 能被 Kodi 打开主要字段（标题、年份、剧情、季集）。
- 本地文件写出 HDR / 杜比视界小标；读不到 dovi 盒子时不标杜比视界。
- 播放中途返回，海报墙「继续观看」出现这一条。

### 阶段 4 — CatSpider

- QuickJS 跑通 `getConfig` / `search` / `getTracks` / `getPlayinfo`，限额与 ADR-0014 一致：超时、超内存会结束上下文而不是把应用杀掉。
- 内置 `src/engine/online/vod-sites.json` 里选定的一批脚本（阶段开始时按当时还能访问的站点列出名单）能搜索并播放。名单外的脚本允许失败。
- cheerio 探针记录的调用有测试；未实现的调用返回明确错误，不把 Node 对象漏进解释器。
- 挑战页：OkHttp 失败后按熔断规则冷却；若启用 WebView 补救，硬封锁仍然不弹窗。
- POST 请求不会打开 WebView。

### 阶段 5 — 直播

- 导入一份 M3U，上下键换台，HLS 可播。
- 一份 XMLTV（含 gzip）在 12 小时内不重复下载，频道上能看到当前节目。
- HTTP MPEG-TS 在 Media3 里可播。
- RTSP 或 UDP 地址显示说明，不崩溃。
- 播放列表解析和流类型夹具通过。

### 阶段 6 — SMB、WebDAV、115

- SMB：只读添加共享，文件名刮削进海报墙，点开能播，中途拖动能继续（Range）。
- WebDAV：根目录暂时不可达时，已有条目还在；etag 未变的目录不整层重扫。
- 115：手机扫码后能列一个目录并播放一个文件；过期地址会在 App 内重新获取。
- 这三类源都不往远端写 NFO，也不做 HDR 探测。

### 阶段 7 — 可选 libmpv（可砍）

- 默认安装包体积和许可不包含 libmpv。
- 安装可选模块后，同一条 ASS 字幕能显示 `\pos` 一类效果；默认引擎下这条字幕只有对白。
- 可选模块能打开一条默认引擎拒绝的 FLV 或 RTSP 直播。
- 对应源码按 `docs/release-licenses.md` 的要求可以下载。

## 8. 仓库组织

**安卓工程用新仓库，不放进本仓库目录。**

本仓库是 pnpm、electron-vite、ESLint 和体积检查的桌面 / 服务端工程。Gradle、NDK 和 ABI 产物放进来会和这套检查缠在一起，发布节奏（电视商店和 electron-builder）也不一样。默认电视包要维持和桌面本体相同的 MIT 边界，GPL 的可选播放器更不适合进现在的 `extraResources`。

规格留在本仓库，实现放在新仓库：

- 后续在本仓库加一个导出脚本（本次不写），把第 3 节点名的 Vitest 用例输出成 JSON 夹具。
- 新仓库把夹具当测试输入。桌面改了解析器或 CMS 解析，夹具差异要在评审里看得见。
- 站点表直接复制仓库根目录的 `cms-sites.json` 和 `src/engine/online/vod-sites.json` 进 assets，版本跟着电视发版走。

新仓库内部按模块分开即可：`ui`、`player`、`online`、`library`、`live`、`storage`。可选 libmpv 单独一个模块，默认构建不依赖它。

若一定要放在同一个 Git 仓库里，只接受这种摆法：顶层 `apps/tv` 独立 Gradle 工程，本仓库的 `pnpm` 脚本和 `scripts/check-size.mjs` 不扫描它，CI 用单独的工作流。即便如此，仍然更建议新仓库。夹具用子模块或发布文件同步，不要为了「一个 PR 改两端」把 NDK 放进桌面工程。
