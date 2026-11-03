# 安卓连接 NAS 片库并播放（子项目 B1）

日期：2026-11-03
状态：设计已定（用户要求不等确认直接开发，设计取最保守的做法）

## 背景与目标

子项目 A 已让安卓有了播放内核。B1 让安卓端能连上 NAS 上的影盒（`src/server`，ADR-0010、ADR-0026），浏览它的电影与剧集库，并直放 NAS 上的文件（杜比视界、DTS、TrueHD 等），带外挂字幕和观看进度。

NAS 版影盒与安卓内嵌的服务是同一份 `src/server`，HTTP 接口一致（`docs/library-server.md`「接口一览」）：Bearer 令牌鉴权，`/api/library/rpc` 调片库方法，`/media/files/<fileId>` 出视频流（Range），`/media/subtitles/<fileId>` 出外挂字幕（WebVTT），`/media/image/<key>?w=` 出海报。

不在范围内：WebDAV / SMB 直连（B2）、新的控制层界面（C）、P5 服务端重建（D）、片库管理（扫描、刮削、改匹配）。

## 决策

1. **直接调片库 RPC，不加 view 域方法。** 安卓与 NAS 的版本可能不同步，片库 RPC 与桌面端同一份契约、最稳定；view 域方法在旧 NAS 上可能不存在。只解析需要的字段，解析函数是纯函数，用 JVM 测试覆盖。
2. **两个服务端并存。** 内嵌服务继续负责在线源；NAS 是第二个 `ServerClient`，只负责片库。NAS 没配置或连不上时，片库入口隐藏，在线功能不受影响。
3. **连接配置存设备设置**（ADR-0033）：`nas.url`、`nas.token`。设置页「NAS」一组：地址、令牌、「测试连接」。测试用 `GET /api/health` 加带令牌的 `GET /api/info`。
4. **明文 HTTP 放开。** NAS 通常是局域网 `http://192.168.x.x:端口`，网络安全配置从「只放行 127.0.0.1」改为 `base-config` 允许明文。令牌随明文传输，只在可信局域网里使用，写进设置页说明和 ADR。
5. **播放走直放。** 片库文件地址 `NAS地址/media/files/<fileId>`，播放器的 HTTP 工厂带 `Authorization`；外挂字幕用 `MediaItem.SubtitleConfiguration`（id 以 `ext:` 开头，与子项目 A 的 `EXTERNAL_ID_PREFIX` 一致，字幕列表里显示「外挂」）。
6. **进度写回 NAS。** 开播前 `progress.list` 取续播位置；播放中每 5 秒与暂停、退出、播完时 `progress.save`。进度存 NAS 的片库数据库，与桌面、网页端共用。
7. **播放界面拆出共用的 `PlayerHost`。** 现在的 `PlayerScreen` 把播放器创建、遥控按键、提示与错误浮层、在线换源、进度上报混在一起。把前三项抽成 `PlayerHost`，在线播放（`PlayerScreen`）与片库播放（`LibraryPlayerScreen`）各自只管来源与进度，在线播放的行为不变。

## 结构

新建 `com.yingbox.android.library`：

- `NasConfig`：`data class NasConfig(val url: String, val token: String)`，`fun normalizeNasUrl(raw: String): String?`（补 `http://`、去尾部斜杠、拒绝空与非 http(s)）。纯函数。
- `LibraryModels`：`LibraryCard`（id、类型、标题、年份、评分、海报 URL、背景 URL）、`LibraryEpisode`（itemId、季、集、标题、简介、文件）、`LibraryItem`（卡片字段加简介、runtime、类型、文件列表、季集）、`LibraryFile`（fileId、大小、动态范围标签）、`LibraryProgress`（itemId、fileId、position、duration、watched）。
- `LibraryParsers`：`parseQuery(json)`、`parseItem(json)`、`parseProgress(json)`、`mediaImageUrl(base, raw, width)`（`yingbox-media://image/<key>` → `/media/image/<key>?w=`，`http(s)` 原样，其余为 null）。纯函数，用 `org.json`，单测用 `org.json:json`。
- `LibraryApi(client)`：`query(types, search, offset, limit)`、`item(itemId)`、`progress(itemIds)`、`saveProgress(report)`、`subtitles(fileId)`；全部走 `POST /api/library/rpc` 或 `/media/subtitles`，阻塞调用，不放主线程。

界面：

- 底部导航加「片库」，设置里配置了 NAS 就显示；连不上、令牌不对时片库页给出原因并提供「去设置」。
- `LibraryScreen`：电影 / 剧集切换、搜索、海报网格（复用现有海报卡），无限加载。
- `LibraryDetailScreen`：背景、简介、播放 / 继续播放按钮；剧集有季选择与集列表。
- `LibraryPlayerScreen`：见决策 5、6。

## 数据流

配置 NAS → 测试通过 → 片库页 `query` → 点卡片 `item` → 点播放：`progress.list` 取续播位置 → 选文件（多版本取第一个视频文件；动态范围标签显示在按钮旁）→ 取外挂字幕列表 → ExoPlayer 起播 → 周期性 `progress.save`。

## 错误处理

- 地址不合法：设置页就地提示，不保存。
- 连不上 / 令牌错误：`测试连接` 区分「连不上」「需要令牌或令牌错误（401）」，片库页同样提示，并给「去设置」。
- 播放出错：沿用子项目 A 的中文错误映射；片库播放没有「换源」，只提示。
- 字幕列表取不到：不影响播放，忽略。

## 测试

- JVM 单元测试：`normalizeNasUrl`、`parseQuery`、`parseItem`（电影、剧集带季集、缺字段）、`mediaImageUrl`。
- 端到端：电脑上跑 `src/server`（带一个含测试视频的片库），模拟器经 `10.0.2.2` 连上，验证 配置 → 浏览 → 播放 → 进度写回 → 外挂字幕。杜比视界、DTS 的真实效果仍需要真机。

## 风险

- 令牌明文传输（见决策 4）。
- 版本取服务端 `versions`（最好的在前，电影可选版本）；分段版本（CD1 / CD2）目前只播第一段。
- 从 `PlayerScreen` 抽 `PlayerHost` 触及在线播放，要保证换源、续播、进度上报行为不变；靠真机回归在线播放一遍。
