# 片库刮削：桌面版与片库服务（NAS）对照

电影、剧集的扫描、识别、刮削、写出全部在 `src/main/library`，两种宿主经 `createLibraryService` 构造同一个 `LibraryService`；
宿主差异只在 `LibraryPlatform` 注入的几项（`src/main/library/platform/platform.ts`）。
桌面端在 `src/main/library/engine/entry.ts` 注入，片库服务在 `src/server/app.ts` + `src/server/library-host.ts` 注入。
`tests/server/no-electron.test.ts` 保证服务端整张依赖图里没有 `electron`。

## 对照表

| 功能                       | 桌面版                                                        | 片库服务                                                                              | 说明                                                                                                                                |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TMDB 识别 / 刮削           | `net.fetch`（Chromium，系统代理）；令牌 safeStorage           | Node fetch（undici）/ curl(-impersonate)；令牌 `secrets.json` 或 `YINGBOX_TMDB_TOKEN` | 同一个 `TmdbProvider`。国内访问 TMDB 要代理：服务端设 `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`                                        |
| 豆瓣类型补全（#162）       | `genre-fill.ts` → `m.douban.com/rexxar/api/v2/search/movie`   | 同一份代码，Node fetch 原样带 Referer + 移动 UA                                       | rexxar 只看 Referer / UA，Node fetch 能直接拿到结果；被拦时补全停下只记日志。需要浏览器指纹时设 `YINGBOX_FETCH=curl:<curl_chrome…>` |
| OpenSubtitles 哈希辅助识别 | 扫描算指纹（`fingerprint.ts`，读头尾 64 KiB）                 | 同上；key 来自片库设置或 `YINGBOX_OPENSUBTITLES_KEY`                                  | 纯 Node                                                                                                                             |
| NFO 写出与合并             | `writer/`（保留手改字段）                                     | 同上                                                                                  | 媒体目录要可写；`docker-compose.yml` 默认只读挂载，要写出 / 整理时去掉 `:ro`                                                        |
| 图片缓存、缩略图           | `ImageCache` 原图；缩略图 `nativeImage`                       | `ImageCache` 原图；缩略图 wasm 解码 / 缩放（编解码线程）                              | 同一个 LRU 目录结构                                                                                                                 |
| 整理改名                   | `writer/organize`（批次可撤销）                               | 同上                                                                                  | 同 NFO 写出，需要可写                                                                                                               |
| 季、集识别                 | `runner-series.ts` + `episode-mapping.ts`                     | 同上                                                                                  |                                                                                                                                     |
| 多版本合并                 | `catalog/merge`；动态范围来自 ffprobe 探测                    | 同上；ffprobe 来自 `YINGBOX_FFPROBE` 或 PATH                                          | 没有 ffprobe 时探测任务第一份文件就停下，版本的 HDR / DV 标退回看文件名                                                             |
| 外挂字幕自动挂载           | IPC `subtitle:find / read`（srt / ass → WebVTT）              | `GET /media/subtitles/<fileId>`、`GET /media/subtitles/<fileId>/<文件名>`             | 同一份 `src/main/subtitle.ts`（编码判断、格式转换）；网页播放器经 `sidecar-subtitles.ts` 挂载                                       |
| 自动中文字幕（入库后下载） | 主进程设置 `subtitles.auto.*`                                 | `YINGBOX_AUTO_SUBTITLES=1`、`YINGBOX_SUBTITLES_DAILY_LIMIT`（1–100，默认 5）          | 同一个 `AutoSubtitles`；内封字幕流也用 ffprobe 看                                                                                   |
| 播放器在线字幕搜索 / 下载  | IPC `subtitle:searchOnline / downloadOnline`                  | 没有                                                                                  | 网页播放器的在线字幕面板提示需要桌面版                                                                                              |
| 观看进度与同步             | `progress.*` RPC；桌面端定时与服务端双向合并                  | 同一套 `progress.*`（服务端就是同步的对端，Bearer 调 `/api/library/rpc`）             | 见 [progress-sync.md](progress-sync.md)                                                                                             |
| 海报人脸焦点（ADR-0013）   | 启发式焦点（缩略图管线）+ Chromium `FaceDetector` 细化        | 启发式焦点（同一管线），`POST /media/focus`、`/media/focus/save`                      | 浏览器没有 `FaceDetector` 时只有启发式                                                                                              |
| 自动入库：扫描与监控       | `LibraryMonitor`（事件 + 定时扫描 + 写入稳定判定），模式 auto | 同上，`YINGBOX_WATCH` / `YINGBOX_SCAN_INTERVAL` / `YINGBOX_SETTLE_SECONDS`            | 见 [library-server.md](../library-server.md)「自动入库」                                                                            |

## 片库服务没有的宿主能力

不属于电影 / 剧集刮削，服务端不注入：

- AI 识别兜底（`ai`）：桌面端经主进程 `aiService` 代办；
- WebDAV / Alist 远程源（`remote`）：凭据在桌面端主进程；
- 系统通知：只在桌面端；NAS 的 `intake.onArrivals` 与追更入库由服务端发送 Bark / Telegram（ADR-0023）。

## 测试

- `tests/server/scrape-parity.test.ts`：假 TMDB + 假豆瓣 + 假 ffprobe，经 HTTP RPC 走识别、季集、补类型、多版本动态范围、写出 NFO、整理预览、进度导出 / 导入；
- `tests/server/subtitles.test.ts`：外挂字幕接口（编码、ass 转换、只读列表内文件、大小上限、鉴权）与自动字幕 / 工具路径的环境变量；
- `tests/player-sidecar-subtitles.test.ts`：网页播放器经片库服务取字幕、桌面端照旧走 IPC。

## 需要真机验证

- 国内网络下 Node fetch 访问豆瓣 rexxar（测试只在海外出口验证过可达）；
- NAS 上装 ffmpeg 后的 HDR / 杜比视界探测与内封字幕判断；
- 真实 OpenSubtitles 下的自动中文字幕（每日上限、额度用完）；
- 网页播放器在 Chrome / Safari / 手机上挂外挂字幕的显示（ass 样式会丢，只保留文字）。
