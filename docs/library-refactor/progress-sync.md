# 观看进度同步与下一集自动续播

片库条目（一部电影或一集）的播放位置、是否看完、最后观看时间存进片库数据库；桌面端配了片库服务（NAS）时，两边的进度自动双向合并。剧集播完后倒计时 5 秒自动播下一集（内置播放器和 mpv 都支持）。

## 数据模型

迁移 v9 新建 `watch_progress` 表（`src/main/library/db/schema-progress.ts`），一条对应一个电影或一集条目：

| 列                      | 说明                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `item_id`               | 主键，指向 `media_items`；条目被删（重扫后不在了）时级联删掉                      |
| `file_id`               | 播放的那个视频文件（分段电影、多版本时有用）；文件被删只清成 NULL，进度留在条目上 |
| `position` / `duration` | 播放位置、总时长（秒）；时长不知道为 0                                            |
| `watched`               | 0 / 1，看完                                                                       |
| `updated_at`            | 最后观看或手动标记的时间（毫秒），合并时后写胜出；有索引 `watch_progress_updated` |

桌面端引擎和独立片库服务各存一份，同一套 SQL（`src/main/library/progress/progress-store.ts`）。

## 看完判定（90% 阈值）

纯规则在 `src/shared/library/watch-progress.ts`，引擎、片库服务、桌面同步、渲染层共用：

- `WATCHED_RATIO = 0.9`：播到总时长的 90% 或播到结尾（`ended`）记看完；总时长未知时不按位置判断。追剧日历原来自己用 95%，现在改为引用同一个常量，日历、防剧透、「今晚看什么」与片库进度判定一致。
- 看完之后从头重看，`watched` 仍保留，直到手动标成未看。
- 手动标记（上报带 `watched`）直接定看完 / 未看；标成未看同时把位置清零。
- 一次上报没带时长（0）时沿用旧的；位置不超过时长。
- 上报没带 `at` 时用引擎收到的时间；把旧的本地进度搬进片库时带原记录时间（`features/library/progress/legacy.ts`），旧的本地表不删。

海报墙概况（`progress.summary`）：电影看完 = 该条目看完，比例 = 位置 / 时长；剧看完 = 每一集有文件的都看完，比例 = 看完集数 / 有文件的集数。详情页 / 海报墙的「已看」「看到 12:30」标记规则在 `features/library/progress/watch-marks.ts`，播过 10 秒以上才显示「看到」。

## RPC

契约在 `src/shared/library/ipc/contract-progress.ts`，并入 `LIBRARY_METHODS`，参数校验在 `validate-progress.ts`；单次最多 `PROGRESS_BATCH_LIMIT = 5000` 条。

| 方法                                       | 作用                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| `progress.list(itemIds)`                   | 这些条目及其下属（剧 → 季 → 集）的进度                  |
| `progress.save(reports)`                   | 写入上报，按条目用 `applyReport` 合并，返回写入后的进度 |
| `progress.summary(itemIds)`                | 海报墙顶层条目的观看概况，没看过的不返回                |
| `progress.recent(limit)`                   | 最近观看的顶层条目（每个一条），供「继续播放」          |
| `progress.export(since)`                   | 导出能对上跨库键、`updatedAt ≥ since` 的进度            |
| `progress.import(entries, preferIncoming)` | 导入，比本地新的才写                                    |

渲染层经 `window.api.library.progress.*`（preload）或网页端的 HTTP 桥调用；`export / import` 只给主进程同步用，不暴露到 bridge。

另有 Electron 域 `progressSync`（`src/shared/contract/progress-sync.ts`）：`status`、`syncNow`，事件 `changed`（状态）和 `applied`（拉下来写进本地的条目 id，渲染层据此刷新进度缓存和「继续播放」）。

## 桌面端 ↔ 片库服务同步

代码在 `src/main/library/progress-sync/`：`syncer.ts`（合并顺序，不依赖 Electron，可单测）、`remote-peer.ts`（HTTP）、`index.ts`（接 Electron）。

**设置**：`library.progressServer`（服务地址，空串 = 不同步）和密钥 `library.progressServerToken`（Bearer 令牌），在媒体库设置的「观看进度同步」组里填。

**身份键**：两边条目 id 不同，用可移植的键对上（`progressSyncKey`）：

1. 电影有 TMDB id → `movie:<tmdbId>`；
2. 一集，剧有 TMDB id 且季、集号已知 → `tv:<剧的 tmdbId>:<季>:<集>`；
3. 都没有时用播放文件的内容指纹 → `fp:<指纹>`；
4. 什么都对不上的条目不同步。导入时本地对不上的条目计入 `unmatched` 跳过。

**一轮同步**：

1. 拉：服务端 `progress.export(since)` → 本地 `progress.import(preferIncoming = true)`；
2. 推：本地 `progress.export(since)` → 服务端 `progress.import(preferIncoming = false)`；
3. 成功后把本轮开始时间记成游标（`userData/library/progress-sync.json`，按服务端地址记，换地址从 0 全量合并）。

**规则**：

- 按 `updatedAt` 后写胜出；时间戳相同以服务端为准（拉时 preferIncoming 为真，推时服务端保留自己的）。
- 时钟容差：`since = 游标 − SKEW_MS`，`SKEW_MS = 10 分钟`，两台机器时钟差在 10 分钟内不会漏同步；重叠的部分靠后写胜出去重，不会重复写。
- 触发：启动时、每 3 分钟、改了地址或令牌、点「立即同步」。同一时刻只跑一轮，重复触发复用正在跑的那一轮。
- 失败只记进状态（`error`），下一轮再试；不影响本地读写。
- 服务端地址是用户自己填的（多半是局域网 NAS），不走私网拦截；但只认 http / https、不带账号密码、不跟随重定向、每次请求 15 秒超时，返回体逐字段校验（`parseSyncEntry`）。
- 无痕模式不上报进度（各写入函数自己判断），也就不会被同步出去。

## 下一集自动续播

设置 `player.autoNext`（默认开）：剧集播完或进入片尾后倒计时 5 秒自动播下一集。

- **内置播放器**：沿用跳过片头片尾的「下一集」卡片（`features/player/skip/`）；关掉 autoNext 时卡片照常出现但不倒计时，要点「立即播放」。小窗放不下卡片，开着时直接连播。
- **mpv**：`features/player/mpv-session/`。mpv 用 `--keep-open=yes` 启动，播到结尾停在最后一帧不发 eof，所以按位置判断：暂停且离结尾不到 1.5 秒算播完（`mpv-session-rules.ts`）。播完记看完，有下一集时用新加的 `mpv.showText`（OSD，最长 10 秒、200 字）在 mpv 画面上倒计时 5 秒再换；倒计时中拖回去或继续播就取消；没有下一集时显示提示。进度每 2 秒记一次，mpv 退出时记最后的位置。
- 同一时刻只跟一个会话：新开播（mpv 或内置播放器）就换掉。
- 睡眠定时「看完本集」到点时停在本集，不连播。

「继续播放」记录从片库进度生成（`features/library/progress/continue-source.ts`）：电影没看完从那个位置继续，看完不列；剧那一集没看完从那一集继续，看完了指向下一集（本季后面的或后面季的第一集），没有就不列。

## 测试

- `tests/library/engine/watch-progress.test.ts`：表、合并、概况、最近、导出 / 导入。
- `tests/progress-sync.test.ts`：先拉后推与同时间戳以服务端为准、游标往回让 SKEW_MS、换地址全量、出错不写游标、同时触发只跑一轮；服务端地址校验、Bearer / 不跟重定向 / 坏条目丢弃 / 401；设置页状态文案。
- `tests/library-progress.test.ts`：渲染层上报批量写入与重试、旧本地进度迁入、继续播放记录生成、详情与海报墙标记。
- `tests/player-library-progress.test.ts`：媒体库条目只上报片库、无痕不报、续播位置、继续播放合并、mpv 会话判定。

## 未真机验证

以下只有单测覆盖，没有在真机 / 真 NAS 上跑过：

- 桌面端与真实片库服务（NAS 上的 `src/server`）之间的端到端同步，包括令牌鉴权失败、服务端旧版本（没有 `progress.*` 方法）时的报错文案。
- 两台机器时钟差接近或超过 10 分钟时的实际表现。
- mpv 真实播放到结尾时 `--keep-open` 的状态推送（暂停、位置离结尾 1.5 秒内）是否稳定触发；`showText` OSD 的显示效果；倒计时中拖动取消。
- 内置播放器片尾卡片在开 / 关 autoNext 下的实际交互。
- 旧本地进度迁入片库在大量历史记录下的耗时。
- 网页端（片库服务直连）的进度上报与海报墙标记。
