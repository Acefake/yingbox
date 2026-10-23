# 媒体库重构 P3：识别与刮削 Provider 层

P3 在 P2 引擎（utilityProcess + SQLite）里接上元数据源：识别每个电影 / 剧集，拉元数据入库，缓存海报与背景图。
UI 不改（P4），不写 NFO、不改名（P5），但接口都已留好。

## 模块

```
src/main/library/
  providers/
    http/            统一 HTTP 层：令牌桶限速、并发信号量、429 / 5xx / 网络错误重试、在途去重、provider_cache + ETag
    tmdb/            TMDB v3：search / details(append_to_response) / season / episode_group / find；原始响应 → 通用形状
    opensubtitles/   moviehash 反查（有 API key 才启用）
    settings-store   引擎侧设置（TMDB 令牌持久化在这里）
  identify/
    identify-module  组装 + 识别相关 IPC 方法（纯规则在 identify-rules，任务执行在 identify-job）
    identify-runner  执行器：批量执行、应用匹配、写季 / 集；电影 / 剧集 / 手动匹配在 runner-movie / runner-series / runner-manual，纯规则在 runner-rules
    identify-store   选目标、读文件 / 子条目 / NFO、写 matches（行转换在 identify-rows）
    metadata-writer  元数据写入 media_items（常用字段成列，完整元数据存 JSON）
    episode-mapping  本地集 → (季, 集)，绝对集数按剧集分组顺序
    media-duration   只读容器头取时长（mkv / mp4 / mov），不依赖 ffprobe
  images/image-cache 引擎下载原图（poster w780、backdrop w1280）
src/shared/library/
  identify/identify  识别链与分档搜索（纯 TS）
  provider/metadata  元数据形状（MediaMetadata / SeasonMetadata / EpisodeMetadata / ImageCandidate…）
```

## 识别链

锁定 > NFO id > 文件名 / 文件夹 id > OpenSubtitles hash（无 key 跳过）> 搜索打分。

搜索打分分三档，够自信（≥ 0.85 且领先第二名 ≥ 0.05）就停：

1. 每个标题（中文名 / 英文名 / 原名，归一化去重）带年份搜；
2. 不带年份再搜，并把“标题 + 年份”整体当标题搜——修 `Reply 1988 S01E05` 被解析成片名 Reply、年份 1988；
   排序时若把年份并进标题后标题更像，就改用“不比年份”的分数，所以 `Heat.1995` 这类真带年份的仍按年份区分；
   拉丁文标题再用 en-US 搜一次补齐英文译名；
3. 精排：前几名取详情（全部别名 / 译名 / 电影时长 / 剧集各季集数）重新打分。详情就是入库用的那份，缓存命中后不额外花请求。

两个不同条目都过自动阈值且几乎同分（没写年份的同名翻拍）时判为待确认，不靠热度硬选。

- 电影：同目录、解析结果相同的文件（多版本 / 分段）一起识别一次；时长从容器头探测（取不到就不计）。
  不同目录的同名无年份文件（P2 临时合并在一个条目里）各自识别，匹配到不同影片时拆成新条目
  （`local_key` 加 `#tmdb:<id>`）。
- 剧集：在剧集文件夹层识别一次，tvshow.nfo、文件夹名、各集文件名里出现最多的剧名写法都参与；
  用本地集数最多的那一季校验候选（季不存在 0 分、集号超出 0.3），全是绝对集数时比对总集数。
  匹配后按季 / 集写每季每集；绝对集数优先按 TMDB“绝对”类型的剧集分组映射（分组里插入的特别篇也算），
  没有分组时按正片季依次拼接；TMDB 上不存在的集清空元数据、标为 unmatched。
- 阈值：auto ≥ 0.85；review 0.6–0.85（matches 存前 3 候选）；其余 unmatched（也存最接近的候选）。
- locked 永不被自动识别覆盖；刷新元数据时只更新元数据本身。
- 扫描后自动排识别，只处理“没识别过或文件变过”的条目；已自动匹配的只补新增的季 / 集，不重新搜索。

## HTTP 层

| 项             | 默认                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 限速           | 令牌桶 20 rps（突发 20），所有 TMDB 请求共用                                                                                                  |
| 并发           | 8 个在途请求                                                                                                                                  |
| 429            | 按 Retry-After（秒或 HTTP 日期）全局冷却后重试；没有时 2 s                                                                                    |
| 5xx / 网络错误 | 指数退避 0.5 s 起翻倍、0.5–1 倍抖动，最多重试 4 次                                                                                            |
| 401 / 403      | 立即失败，识别任务以“请检查 API 令牌”结束，不逐个重试                                                                                         |
| 去重           | 同缓存键的并发请求共用一个 Promise                                                                                                            |
| 缓存           | provider_cache 表 + 进程内 LRU 2000 条；搜索 1 天、find 7 天、详情 7 天、已完结剧 / 上映一年以上的电影 30 天、定型的季 30 天；404 也缓存 1 天 |
| ETag           | 过期条目带 If-None-Match，304 只续期；刷新元数据就是让缓存过期再走条件请求                                                                    |

网络请求在引擎里用 Electron `net.fetch`（Chromium 网络栈，走系统代理——国内访问 TMDB 通常要代理），
不可用时退回 Node fetch。没有复用 `http-client.ts`：它的 SSRF 防护针对用户输入的任意 URL，TMDB 是固定公网主机，
且它不处理代理。

TMDB 令牌：渲染进程启动时与修改设置时经 `setProviderToken` 下发，引擎存在 settings 表；
状态接口只回 `configured`，令牌不进日志、不回传。v4 读访问令牌（eyJ…）走 Bearer，v3 api_key 走查询参数，缓存键不含令牌。

## 元数据

标题 / 简介 / 标语按 zh-CN → zh-TW → zh-HK → zh-SG → en 回退（取 translations），原名、年份、上映日、类型、评分、时长、
制片国家、公司、分级（中国大陆优先，其次美国）、前 15 位演员、导演 / 编剧（剧集还有主创）、图片候选（poster / backdrop / logo，
海报与标志按 中文 > 英文 > 无文字 排、背景图无文字优先，再按评分、票数）、外部 id（tmdb / imdb / tvdb）。剧集含季与每集
（标题、简介、播出日、时长、评分、剧照）。

常用字段各占一列（title、original_title、year、overview、poster、backdrop、logo、rating、runtime、genres、air_date、
tmdb_id / imdb_id / tvdb_id），完整元数据存 `media_items.metadata`（JSON，`level: title | season | episode`）。
检索文本合并本地标题与元数据标题，按文件名里的写法和 TMDB 中文名都能搜到。

## 图片

引擎把每个电影 / 剧集选中的海报（w780）和背景图（w1280）下载到 `<userData>/library/media/orig/`，key 是 URL 的
SHA-1 前 32 位；下载完通知主进程预热缩略图。缩略图是全应用共用的一套（`src/main/thumbnails`、地址规则 `src/shared/media-url.ts`）：
主进程用 `nativeImage` 缩放（nativeImage 在 utilityProcess 里不可用），再交给 worker 线程用 wasm libwebp（`@jsquash/webp`，无原生依赖）
编码成 WebP，写到 `media/thumb/`（与在线封面共用一个 512 MB LRU 上限）。
编码器不可用时退回 nativeImage 的 JPEG。季海报、剧照、标志只存 TMDB 远程地址，不下载。

`yingbox-media://image/<key>?w=300|480|780` 返回缩略图（没有就现生成），不带 `w` 返回原图；任意来源用
`yingbox-media://thumb/?w=…&src=…`。响应带
`Cache-Control: public, max-age=31536000, immutable` 和 ETag。CSP 的 img-src 已加入 `yingbox-media:`。

## 给 P4 / P5 的接口

渲染进程 `window.api.library`：

| 方法                                                                 | 用途                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `identify({ libraryId? , itemIds?, force? })`                        | 排识别任务；force 重新识别非锁定条目                                   |
| `refreshMetadata({ libraryId?, itemIds? })`                          | 重新拉元数据与图片（含锁定条目），不改匹配                             |
| `getMatchCandidates(itemId)`                                         | 当前匹配 + 保存的候选（标题、年份、置信度、分项分、w185 海报）         |
| `applyMatch({ itemId, tmdbId \| imdbId \| tvdbId \| query, lock? })` | 手动指定（默认锁定）或按搜索词重新识别（够自信直接应用，否则返回候选） |
| `lockMatch(itemId)` / `unlockMatch(itemId)`                          | 锁定 / 解锁                                                            |
| `setProviderToken(provider, token)` / `getProviderStatus()`          | 令牌下发与状态                                                         |

事件：`identify-progress`（250 ms 节流，`finished` 收尾，含 matched / review / unmatched / failed 计数与错误原因），
`items-changed`（识别过程中分段推送）。`LibraryItemSummary` 新增 `backdrop`、`rating`；`LibraryItemNode` 新增
`overview`、`logo`、`runtime`、`genres`、`airDate`、`metadata`。

P5 写 NFO 需要的数据都在 `metadata` 里（uniqueid 用 `externalIds`，演职员、分级、类型、评分、季 / 集标题与播出日期）；
P5 若需要演员头像、季海报、剧照本地化，可复用 `ImageCache.ensure(urls)`。

## 基准

`pnpm bench:identify`（`scripts/bench-identify.ts`）：合成 1000 部电影（15% 同名翻拍、10% 续集、5% 片名带年份、
10% 文件名不带年份；文件名混合 `Title.Year.1080p…`、`中文名.Title.Year…`、`Title (Year)/Title.mkv`），
假 TMDB 每个请求固定 100 ms 延迟，跑真实引擎的识别任务（不含图片下载）。Linux 容器 2 vCPU，Node 22。

| 场景                       |    耗时 |              吞吐 |           请求数 |
| -------------------------- | ------: | ----------------: | ---------------: |
| 缓存未命中，20 rps（默认） | 108.9 s |       9.2 部 / 秒 | 2199（2.2 / 部） |
| 缓存未命中，40 rps         |  54.0 s |      18.5 部 / 秒 |             2199 |
| 缓存命中（强制重识别）     |   0.8 s | 1150–1300 部 / 秒 |                0 |

未命中时瓶颈是限速（2.2 请求 / 部 ÷ 20 rps），100 ms 延迟被 8 并发完全掩盖；20 rps 是给 TMDB（约 50 rps 上限）
留余量的默认值，可在 `IdentifyModuleOptions.http.rps` 调整。

准确率（合成数据的真值）：自动匹配 953，其中错 1（99.9%）；待确认 43，其中 39 个真值在前 3；未匹配 4。
唯一的错配是“片名带年份的电影的续集”（`Rogue Distant 1975 2 (2001)`）。fixture 集成测试覆盖的真实片名
（中文片、繁体片名、中英双标题、同名不同年、续集、片名带年份、Reply 1988、动画绝对集数、特别篇、NFO / tvdb id、
时长区分同名片、临时合并拆分）全部正确。

注意：合成数据和 fixture 都是按 TMDB 响应格式手写 / 生成的（开发环境没有 TMDB 令牌，没法录制），
真实 TMDB 的搜索排序与译名覆盖更杂，真实准确率需要在真实库上复测；有令牌时可以
`VITE_TMDB_ACCESS_TOKEN=… pnpm exec tsx scripts/record-tmdb-fixtures.ts` 把 fixture 换成真实录制。

## 已知限制

- 拆出来的电影条目（`#tmdb:<id>`）在文件内容变化重扫时会被 P2 分组重新挂回原条目，需要再识别一次才会重新拆开。
- 同一部作品出现在两个文件夹 / 两种写法时会是两个条目（各自匹配到同一个 tmdb id），P4 可按 tmdb id 合并展示。
- 按播出日期编号的节目（日播综艺）不做集映射。
- 季 / 集元数据只取 zh-CN（TMDB 季详情没有 translations，缺译名时 TMDB 返回“第 N 集”）。
- 令牌明文存在引擎数据库（与原 localStorage 同级的本机保护），没有用 safeStorage；旧的刮削页仍从 localStorage 读令牌，P4 换掉。
- WebP 编码线程与 `@jsquash/webp` 在打包后（asar）的加载、`nativeImage.toBitmap()` 的 BGRA 假设需要在 Windows / macOS 真机上确认；
  失败时自动退回 JPEG，不影响功能。
- 图片缓存不做容量回收；缓存文件被手动删掉时 images 表仍记为已缓存，协议会 404。
