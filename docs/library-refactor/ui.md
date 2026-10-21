# P4 前端：本地电影 / 剧集库

旧的 `views/Movie`、`views/TV`（localStorage 文件树 + 渲染进程刮削）整体换成 `src/renderer/src/features/library/`，
电影与剧集共用一套组件，路由 `/movie`、`/tv` 只差一个 `kind`。数据全部来自引擎（`window.api.library`），
界面不再读写磁盘、不再直接请求 TMDB。

## 目录

```
features/library/
  LibraryPage.vue        页面外壳：查询条件、海报墙 / 待确认、详情覆盖层、各面板
  page/       工具栏、后台任务条、多选操作条、空状态、多选 / 页面操作 composable、页面纯规则
  MovieLibraryPage.vue   /movie（kind="movie"）
  TvLibraryPage.vue      /tv（kind="tv"）
  api/        bridge（window.api.library / writer）、图片地址换算
  state/      查询条件、分页查询（含 items-changed 合并）、媒体库管理与任务进度、引擎事件单一订阅
  wall/       虚拟网格（几何纯函数 + DOM 绑定）、稀疏分页列表、PosterWall.vue（格子纯规则 wall-cells.ts）
  detail/     ItemDetail.vue（Apple TV 风格，载入与操作）+ 头图 / 剧集 / 演职员 / 信息区块组件、详情纯规则、播放列表构造
  review/     待确认队列、匹配对照面板（本地一侧 / 候选卡片）、匹配操作 composable
  writer/     写出与整理的状态机、整理预览面板
  actors/     演员库（番号库）：演员列表、演员详情（资料头 + 作品墙）、编辑锁定面板、界面纯规则
  settings/   媒体库设置（System Settings 风格；写出与整理两组单独成组件）、TMDB 令牌迁移
  shared/     模态面板、格式化
```

## 海报墙

- **虚拟网格自写**（`wall/virtual-grid.ts`，约 120 行纯函数）：行高固定（2:3 海报 + 52px 文字区），任意下标的位置可直接算，
  不测量 DOM。只渲染视口 ± 2 行，5 万条时 DOM 里约 40–50 个格子、全页约 450 个节点。没有引入虚拟列表库。
- **滚动回调每帧最多算一次**（rAF），区间没变就不写响应式状态；尺寸变化走 ResizeObserver。格子只有 `transform` 随位置变，
  点击 / 键盘 / 右键都在网格上委托，格子没有组件实例和监听器。
- **按需分页**（`wall/paged-list.ts`）：滚到哪页取哪页（200 条），同页并发合并；换查询条件时“换代”，旧代迟到的响应丢弃，
  新数据到达前保留旧数据，不闪白。5 万条对象不进响应式系统，只有一个 `version` 计数驱动渲染。
- **快速滚动不解码飞过的图**：一帧滚过半行以上标记 fast，期间新进入的格子先画占位，停下 120ms 后再给 src。
- 海报用本地 300w 缩略图（`mediaImageUrl(key, 300)`；缓存失败时退回 TMDB w342），`loading=lazy`、`decoding=async`，
  格子带 `content-visibility: auto` 与 `contain`。
- 排序：添加时间 / 片名 / 年份 / 评分（引擎新增 `rating` 排序，无评分排最后），每种媒体库记住自己的排序。
  筛选：全部 / 已匹配 / 待确认 / 未匹配 / 已锁定，多文件夹时可按文件夹。搜索走引擎 FTS，200ms 防抖；顶栏全局搜索（?q=）同样生效。
- **局部更新**：`items-changed` 按 250ms 合并；纯更新且排序不受内容影响（按添加时间、无筛选搜索）时只重载所在页，
  否则重载可见区间。
- 多选：⌘/Ctrl 点选、Shift 连选；操作条支持重新识别、写出 NFO 与图片、整理。方向键在格子间移动，回车打开。

## 详情

背景图 780w 铺满头部，向底部与左侧渐隐到页面底色（亮暗主题都落在实色上，文字清楚）；有标志图用标志，否则大标题；
年份 · 时长（剧集为季数）· 分级 · 评分 · 类型；播放（剧集为“播放 S01E01 · 标题”，按本季连播）、修正匹配、锁定、
重新获取元数据、写出、整理；标语与简介（点开展开）。剧集按季分段（特别篇排最后，超过 8 季改下拉），集列表带剧照、
播出日、时长、简介，本地缺失的集变淡。演职员横滑，信息表（原名、上映、编剧、国家、出品、状态、外部 id），文件列表
（大小、目录、在文件夹中显示）。详情由路由 `?item=` 驱动，后退即返回，海报墙滚动位置保留。
播放接现有 `openMediaPlayer`（内置播放器或 mpv，按用户设置），分段电影按文件名顺序连播。

## 待确认

左侧虚拟列表（待确认 / 未匹配 / 全部），右侧对照面板：本地文件名与当前状态，前 3 个候选（海报、年份、原名、
置信度条、简介摘要，`1/2/3` 键采用）。手动搜索一个输入框：片名（末尾年份自动拆出）、TMDB 编号或链接、IMDb 编号或链接；
采用与手动指定都默认锁定。确认后自动跳到下一条。引擎侧给候选加了 `overview`（截断到 160 字存进候选摘要）。
详情页的“修正匹配”打开同一个面板。

## 设置

macOS 系统设置式分组：文件夹（扫描 / 移除 / 添加 / 全量扫描）、元数据（TMDB 令牌、识别全部、重新获取全部元数据）、
写出 NFO 与图片（P5 的 WriterSettings 全部选项）、整理（开关默认关闭、路径模板就地校验、最近批次可撤销）。

TMDB 令牌现在存在引擎（`setProviderToken` / `getProviderStatus`）。启动时做一次性迁移：引擎未配置且 localStorage
（`scrapeProviderConfig.tmdbAccessToken`）有旧值就下发，记下 `library.tmdbTokenMigrated`，之后不再覆盖引擎。
在线页面仍从 localStorage 读令牌，所以媒体库设置里改令牌时两边都写。

## 写出与整理（与 P5 的衔接）

直接用 P5 合并后的共享契约：`window.api.library.writer` 与 `src/shared/library/ipc` 的 `WriterSettings`、
`OrganizePlan`、`OrganizeBatchInfo`、`WriterProgressEvent`，模板变量与校验用 `src/shared/library/writer`。
整理流程：`previewOrganize(itemIds)` → 表格预览（冲突项标红不执行、跨盘标注、已符合模板计数，超过 500 行只显示前 500）
→ `applyOrganize(planId)`（整理开关关闭时按钮置灰并提示去设置开启）→ 完成页可 `undoOrganize(batchId)`。
`writer-progress` 进度并入页面顶部的后台任务进度条。网页版没有 writer 时入口置灰。

## 演员库（番号库）

有番号文件夹时工具栏多一个「演员」视图。

- **演员列表**（`actors/ActorsView.vue`）：圆形头像 + 名字 + 作品数，`UiVirtualGrid` 只渲染视口附近的卡片；
  搜索名字 / 别名（引擎 trigram FTS，短词退回 LIKE）、按作品数 / 名字 / 最近入库排序；列表按 1000 条一页拉全，
  `actors-changed` / `items-changed` 事件防抖 1 秒重拉。右上角「重新获取全部演员资料」排后台任务。
- **演员详情**（`actors/ActorDetail.vue`，路由 `?actor=`）：资料头（大头像、名字、别名、生日与年龄、身高、三围、罩杯、出身地、
  简介，资料还没查到时一句状态说明）放在海报墙的 `before` 插槽里，作品墙直接复用 `PosterWall` + `usePagedQuery`
  （`query({ actorId })`），大量作品同样虚拟化。点作品打开条目详情（叠在演员详情上，后退回到演员）。
- **条目详情 → 演员**：番号库条目的演职员里，演员库里有记录的演员可点（`actors.forItem`），头像换成本地缓存的；
  点开时去掉 `?item=` 换成 `?actor=`，后退回到条目。
- **编辑与锁定**（`actors/ActorEditSheet.vue`）：每个字段一行、右侧锁定开关；只提交改过的字段，改过的自动加锁，
  之后的自动 / 手动刷新都保留锁定字段（规则在 `actors/actor-rules.ts`，引擎侧在 `src/main/library/actors/actor-rules.ts`）。
- **设置**：媒体库设置里「演员资料」一组（`settings/ActorSourcesGroup.vue`）：自动获取开关、来源开关与优先级。
- 网页端经 `http-bridge` 同样可用（两个 transport 共用 `createActorsBridge`）。e2e：`scripts/web-e2e.mjs` 走一遍
  演员列表 → 详情 → 编辑锁定 → 作品 → 条目详情点演员。

## 删除

- `views/Movie`、`views/TV` 及其 composables / components（约 7700 行）
- `services/nfo-service.ts`、`download-service.ts`、`actor-cache-service.ts`（只被旧页面使用）
- `types/index.ts`、`types/scraping.ts`、`utils/media-directory.ts`（只被旧页面使用）
- `file:scanMediaDirectory` IPC 与 preload 方法；`src/main/media-scanner.ts` 与 `utils/avid.ts` 移到 `scripts/legacy/`，
  只给 `bench-library` 做新旧对照（`tests/media-scanner.test.ts` 随之删除，新扫描器有自己的测试）
- 刮削队列面板原来借旧页面的 `useScrapingTask` 做重试 / 清理，改用 `useGlobalQueue` 自身的同名方法（重构 p6：旧页面删除后队列已无生产者，`useGlobalQueue` 删除，面板改为只展示 Lada 的「后台任务」面板 `features/shell/components/BackgroundTasksPanel.vue`）

AV / 在线 / Amane 未改动。

## 性能

`scripts/ui-harness/perf.mjs`：网页版构建 + 假引擎（5 万部电影，query 每次 4ms 延迟），1440×900，
Playwright Chromium headless（aarch64，2 vCPU，软件光栅化），每帧把 `scrollTop` 加固定像素，持续 4 秒，各跑 3 次。

| 场景                                       |  平均 fps |  p95 帧间隔 | >20ms 帧 | long task | 渲染格子 / DOM 节点 |
| ------------------------------------------ | --------: | ----------: | -------: | --------: | ------------------: |
| 基线：静态页 60 个色块（浏览器上限）       |        60 |     16.7 ms |        0 |         0 |                   — |
| 海报墙，60 px / 帧（3600 px/s）            | 60 / 60 / 60 | 16.7–16.8 ms |        0 |         0 |            48 / 451 |
| 海报墙，240 px / 帧（快速甩动，约 0.7 行/帧） | 60 / 60 / 60 | 16.8 ms |        0 |         0 |            42 / 376 |

- 跳到 5 万条末尾：下一帧 22–33 ms 内渲染完（含取最后一页），JS 堆约 36 MB。
- 搜索输入到结果出现约 240 ms（含 200 ms 防抖）。
- 消融（240 px/帧，加快速滚动优化之前）：完整海报墙 22–46 fps；隐藏图片 59.8 fps；去掉阴影圆角无改善 →
  瓶颈是新进入格子的图片解码 / 光栅化，不是 JS 或布局。加“快速滚动不解码飞过的图”后到 60。
- 第一次测出 36 fps 是因为给 Chromium 加了 `--enable-gpu-rasterization`（无 GPU 时更慢），去掉后与基线一致。

这些数字测的是渲染进程这一侧；图片是 342×513 JPEG（真实应用是 300w WebP 缩略图，更小）。Electron 真机（有 GPU）
上的帧率与 IPC 延迟需要再复测。

## 截图

`docs/library-refactor/screenshots/`（`scripts/ui-harness/shoot.mjs` 生成）：

| 内容                 | 暗色                          | 亮色                          |
| -------------------- | ----------------------------- | ----------------------------- |
| 海报墙               | `wall-dark.png`               | `wall-light.png`              |
| 快速甩动停下后       | `wall-after-fling-dark.png`   |                               |
| 多选                 | `wall-selection-dark.png`     |                               |
| 搜索                 | `search-dark.png`             |                               |
| 电影详情             | `detail-movie-dark.png`       | `detail-movie-light.png`      |
| 电影详情（演职员 / 信息） | `detail-movie-info-dark.png` | `detail-movie-info-light.png` |
| 剧集详情             | `detail-tv-dark.png`          | `detail-tv-light.png`         |
| 剧集集列表           | `detail-tv-episodes-dark.png` | `detail-tv-episodes-light.png` |
| 待确认               | `review-dark.png`             | `review-light.png`            |
| 设置                 | `settings-dark.png`           | `settings-light.png`          |
| 设置（写出 / 整理）  | `settings-writer-dark.png`    | `settings-writer-light.png`   |
| 整理预览             | `organize-dark.png`           |                               |

## 已知限制

- 截图与帧率来自网页版 + 假引擎；`yingbox-media://` 协议在浏览器里不可用，假数据用 TMDB 形式地址并在 Playwright 里路由到本地图。
  Electron 真机未跑（沙箱没有图形环境）。
- 同一作品在两个文件夹里是两个条目，海报墙还没有按 tmdb id 合并展示。
- 详情的“在文件夹中显示”用 `shell.openPath(目录)` 打开目录，没有选中文件（preload 没有 showItemInFolder）。
- 旧的“刮削队列”面板已改为“后台任务”面板（只放 Lada 去码 / 边跑边看），媒体库的识别 / 写出进度显示在页面顶部，没有进这个面板。
