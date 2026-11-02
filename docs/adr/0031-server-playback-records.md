# ADR-0031 播放记录存服务端：user_state 表沿用 localStorage 的键与形状

- 日期：2026-11-02
- 状态：已采纳
- 相关：ADR-0028（决策 4：收藏、进度、已看、最近观看存服务端 sqlite，与片库进度同库）、ADR-0030（视图域）

## 背景

桌面与网页把非片库条目的播放记录存在 localStorage：继续观看 `continue_watching`（加墓碑 `continue_removed`）、在线进度 `media_play_progress`、已看 `media_watched`、收藏 `media_favorites`。改记录的规则大多已经是纯函数（`continue-rules`、`watched-rules`），存取写在渲染层。

片库条目（电影、剧集、番号）的观看进度在片库数据库的 `watch_progress` 表里，桌面「继续观看」里的片库记录是从它推导出来的缓存。

安卓原生端没有 localStorage，需要服务端保存这些记录，首页的轮播和继续观看行也要读它们。

## 决策

1. **一张键值表。** 片库数据库迁移 v17 新增 `user_state(key, value, updated_at)`。每个键存一份与 localStorage 同名、同形状的 JSON。以后从桌面导入（ADR-0028 说的第二期）就是原样搬，不需要转换。
2. **规则只有一份。** `continue-rules`、`watched-rules`、`hero-rules` 移到 `src/shared/playback/`；在线进度与收藏的规则抽成 `media-progress.ts`、`favorites.ts`。渲染层的 localStorage 存取和服务端的 sqlite 存取调用同一批函数。
3. **新域 `playback`，只在服务端实现**（`src/shared/contract/playback.ts`、`src/server/playback`）：继续观看的列出、开播、记进度、标记看完、移除；在线进度的读写；标记已看；收藏的列出与切换。入参在契约里校验：继续观看只收 `online`、`av` 两个板块，片库条目的进度走片库的 `progress.save`，片库的继续观看照旧由 `watch_progress` 推导。
4. **服务端单开一个连接。** `src/server/app.ts` 在片库服务建好数据库之后用 `openLibraryDb` 再开一个连接给 `playback`（WAL 下同一进程两个连接没有问题）。node:sqlite 是同步的，一次调用里的「读、改、写」不会和别的请求交错，不需要额外加锁。
5. **无痕是客户端状态。** 无痕时客户端不调写入方法，服务端不记无痕标志。
6. **首页 `view.home` 增加轮播与继续观看行。** 豆瓣部分照旧缓存；继续观看每次请求现读，轮播第一张取最近一条有封面的继续观看（文案用 `resumeKicker`、`resumePlayLabel`），后面接热门电影。片库的继续观看暂不进安卓首页，等推导函数（`features/library/progress/continue-source.ts`）拆掉对渲染层的依赖后接入。

## 后果

- 桌面与网页的行为不变，仍然存 localStorage；安卓与它们的记录暂不互通。
- 安卓轮播里继续观看那一张没有简介和年份：桌面从记录的 `detail`（在线详情条目）里取这两项，服务端不解读 `detail`。需要时在服务端按同样字段窄化读取。
- 迁移 v17 之后，旧版桌面打开同一个 `library.db` 会因版本高于程序而拒绝打开（`migrate` 的既有规则），降级需要先备份数据库。
- 一个键存一整份 JSON，记录数有上限（继续观看 40、进度 80、已看 1000），读写开销可以忽略；以后需要按条查询时再拆表。
- 桌面也会执行迁移 v17，多出一张空表。
- 契约收紧了服务端存储的入参：继续观看的 `key`、`title` 不能为空，集数下标不能为负，`detail` 序列化超过 64 KB 就不存；收藏只存豆瓣卡的已知字段。

## 否决方案

- **每类记录一张关系表**：要为每种形状写映射和迁移，导入桌面数据时还要转换；当前数据量下没有收益。
- **单独的 `playback.db` 文件**：与 ADR-0028「与片库进度同库」不符，备份和迁移要多管一个文件。
- **服务端存片库板块的继续观看**：与 `watch_progress` 成了两份真相，桌面已经在为同步这两份付出代价。
