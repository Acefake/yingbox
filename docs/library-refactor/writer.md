# 媒体库重构 P5：写出层（NFO / 图片 / 整理）

P5 在引擎里补上“写回媒体库”：为已识别的电影 / 剧集写 NFO 与图片，按模板改名移动（整理）。
全部在引擎进程（utilityProcess）里执行，走 P2 任务队列；UI 由 P4 接，本 PR 只提供 IPC。

## 模块

```
src/main/library/writer/
  writer-module       组装、注册任务（writer-write / writer-organize / writer-undo）、writer.* IPC、进度事件
  writer-settings     设置持久化（settings 表 writer.settings，读取时与默认值合并）
  writer-store        writer_outputs、写出时间、整理批次 / 日志、整理后 files 表路径更新
  nfo/xml             XML 转义与生成；容错切块（只切根元素的直接子元素，读不懂返回 null）
  nfo/nfo-builder     movie / tvshow / season / episodedetails
  nfo/nfo-merge       合并模式与 lockdata
  write/output-plan   一个条目写哪些 sidecar（纯函数）
  write/output-writer 单个 sidecar 的写入、跳过判断
  organize/organize-planner  整理预览与冲突检查（只读）
  organize/organize-runner   执行 / 撤销（批次日志、幂等重跑）
  fs/file-ops         原子写、内容未变跳过、移动（跨盘 复制 → 校验 → 删除）
src/main/library/jobs/keyed-mutex   同一媒体库的扫描与整理互斥
src/shared/library/writer/          模板渲染与安全文件名（纯 TS，渲染进程可用来做模板预览）
```

## NFO

写法取 Kodi、Jellyfin、Emby 都能读的交集，并补上各家的旧字段：

| 内容         | 写法                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| 外部 id      | `<uniqueid type="tmdb" default="true">` + imdb / tvdb；另写 `<tmdbid>` / `<imdbid>` / `<tvdbid>`（Emby 旧版）       |
| 评分         | `<ratings><rating name="themoviedb" max="10" default="true">`（Kodi / Jellyfin）+ 顶层 `<rating>`（Emby）           |
| 分级         | `<mpaa>`                                                                                                            |
| 国家         | 中文名（`<country>中国</country>`，Kodi 直接显示文本）                                                              |
| 季名         | tvshow.nfo 的 `<namedseason number="1">`（Kodi 不读 season.nfo）+ season.nfo（Jellyfin / Emby）                     |
| 合集         | `<set tmdbcolid="…"><name>…</name></set>`（P5 给 TMDB 映射补了 belongs_to_collection）                              |
| 远程图片     | `<thumb aspect="poster">`、`<thumb aspect="clearlogo">`、`<fanart><thumb>`：TMDB 原图地址，本地图缺失时播放器可自取 |
| 一个文件多集 | 一个 nfo 里多个 `<episodedetails>`                                                                                  |

其余字段：title / originaltitle / sorttitle / year / premiered / plot / outline / tagline / runtime / genre / studio /
director / credits / actor（name / role / order / thumb / profile / tmdbid）；剧集另有 showtitle / status / episodeguide，
集有 season / episode / aired。文本统一转义 `& < > " '`，并去掉 XML 不允许的控制字符与孤立代理。
`<fileinfo>` 没写：引擎只知道时长，没有编码 / 分辨率 / 音轨，写半套反而让播放器跳过自己的探测。

**合并模式**（默认）按顶层标签分组比较（多个 genre 算一组），依据是上次写入时记下的字段快照
（`writer_outputs.fields`）：

- 磁盘上的值等于上次写的值 → 没人动过，换成新值；
- 不等、或文件不是我们写的 → 保留磁盘上的值（空元素当作没写）；
- 上次写过、磁盘上没了 → 用户删掉的，不补回；
- 其他工具的扩展字段、注释原样保留；uniqueid 保留已有的并补上缺的类型（保证 tmdb id 在）。

快照记的是“我们生成的值”，所以用户改过的字段之后每次都能认出来。**覆盖模式**整份重写。
两种模式都尊重 `<lockdata>true</lockdata>`：直接跳过。读不懂的旧文件（只有一行网址、标签不配对）按新文件处理，不报错；
旧文件按 UTF-8 解码，失败再按 GB18030。

## 文件命名

默认每类只写一份标准名；“兼容旧命名”另写括号里的。

| 场景                                  | 写什么                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 电影独占文件夹（不是库根目录）        | `<视频名>.nfo`（同片多文件时 `movie.nfo`）、`poster.jpg`、`fanart.jpg`、`clearlogo.png`、`.actors/`（`folder.jpg`）                                  |
| 电影与其他电影共用文件夹 / 在库根目录 | 每个视频：`<视频名>.nfo`、`<视频名>-poster.jpg`、`-fanart.jpg`、`-clearlogo.png`（`-movie.jpg`、`-folder.jpg`）                                      |
| 剧集文件夹（库根下第一层）            | `tvshow.nfo`、`poster.jpg`、`fanart.jpg`、`clearlogo.png`、`season01-poster.jpg`（第 0 季 `season-specials-poster.jpg`）、`.actors/`（`folder.jpg`） |
| 季文件夹（与剧集文件夹不同时）        | `season.nfo`（`poster.jpg`）                                                                                                                         |
| 每集                                  | `<视频名>.nfo`、`<视频名>-thumb.jpg`                                                                                                                 |

单文件电影用 `<视频名>.nfo` 而不是 `movie.nfo`：Kodi 只在“电影在各自文件夹”模式下读 movie.nfo，`<视频名>.nfo` 三家任何布局都读；同片多文件（多版本 / 分段）才用 movie.nfo。
剧集文件直接放在库根目录时不写剧集级文件（不能把 tvshow.nfo 写进根目录）。演员头像按 Kodi 约定空格换下划线。
标志只写 png（TMDB 的 svg 标志播放器读不了）。

图片复用 P3 的 `ImageCache`：海报 w780、背景图 w1280 与 P3 缓存同尺寸，直接复制已下载的原图；标志、季海报、剧照、演员头像
按需下载进同一个缓存。合并模式下不覆盖用户自己放的图片（文件不是我们写的，或写完之后被替换过）。

## 原子写与不循环

- 写临时文件 `.名字.yb-xxxxxxxx.tmp`（同目录、点开头，扫描器忽略）→ fsync → rename 覆盖；
- 内容相同（SHA-1）不写、不改 mtime；图片在 writer_outputs 的 hash / size / mtime 都对得上时连目标文件都不读；
- 写完记录 writer_outputs 与 `media_items.written_at`；
- 不循环：nfo / 图片在扫描里只进 files 表，不关联任何条目，扫描收录它们不会让条目变化，就不会触发识别和“识别后自动写出”。
  集成测试验证：写出后整库重扫没有 items-changed、不排 identify、不排 writer-write，再写一次全部跳过。

## 整理（改名移动）

默认关闭；关闭时 `previewOrganize` 可用（只读），`applyOrganize` 以 conflict 拒绝。

模板（相对库根目录，`/` 分目录）：

- 电影 `{title} ({year})/{title} ({year}).{ext}`
- 剧集 `{series} ({year})/Season {season:02}/{series} - S{season:02}E{episode:02} - {episodeTitle}.{ext}`

变量：title、originalTitle、year、tmdbId、imdbId、series、season、episode、episodeTitle、ext；`{x:02}` 补零。
缺值填空后清掉空括号与悬空的 `-`（没有年份 → `Heat/Heat.mkv`；没有集标题 → `… - S01E02.mkv`）；一个文件多集渲染成 `S01E01-E02`；
同一部电影多个文件加 ` - part1` / ` - part2`。保存设置时校验：未知变量、不成对的大括号、绝对路径、`..`、最后一段不是 `.{ext}`、
电影缺 {title}、剧集缺 {episode} 都拒绝。

文件名清洗按最严格的 Windows：`Mission: Impossible` → `Mission - Impossible`，`/ \ |` → `-`，`"` → `'`，删 `< > ? *` 与控制字符，
去结尾的点和空格，CON / NUL / COM1 等保留名加 `_`，单段按 UTF-8 截到 255 字节（不切断汉字）；整条路径超过上限（Windows 259 / 其他 4095）报冲突。

**预览**返回每项 `{ itemId, kind, from, to, conflict?, crossDevice }`：

- `video`：视频本体；
- `sidecar`：同目录以视频名开头、紧跟 `.` 或 `-` 的文件（字幕、nfo、-poster、-thumb、-trailer……），按最长前缀归属，改名只换前缀；
- `folder`：旧文件夹整个属于这个条目（独占的电影文件夹、剧集文件夹、季文件夹）且新旧文件夹不同时，其余文件与子目录（poster.jpg、tvshow.nfo、.actors/……）一起搬。
  .DS_Store / Thumbs.db / @eaDir 不搬，执行后随空目录清掉。

冲突：计划内两项撞名（不分大小写）、磁盘上目标已存在（只改大小写不算）、目标是另一项的原位置、路径过长、模板渲染不出名字、
条目未识别、集没有季号。视频有冲突时同条目的旁挂 / 文件夹项一并不动。计划在引擎内存里保留 30 分钟。

**执行**只做没冲突的项：先写批次与逐项日志（organize_batches / organize_ops），再排 `writer-organize` 任务，返回 `{ batchId, jobId }`。
顺序：视频 → 旁挂 → 文件夹项。每项移动后在一个事务里更新 files 表（保留 id、关联与匹配，只改路径与解析结果，大小 / mtime 以新文件为准），
所以重扫既不会产生新条目也不会重新识别。跨盘（EXDEV）走 复制到目标目录临时文件 → 两边 SHA-1 校验 → 保留时间戳 → rename → 删源。
执行期间持有该媒体库的扫描锁（KeyedMutex），扫描不会拿着旧快照把刚移动的文件当成删除 + 新增。变空的旧目录逐级删到库根为止。

**撤销**按 seq 倒序把已完成的项移回，同样更新数据库、清理新建的空目录；批次状态 running → done / partial / failed → undoing → undone。
中途崩溃或取消后重跑幂等：已完成的项跳过，“源不在、目标在”的项视为已完成。

## IPC

`window.api.library.writer`（类型见 `src/shared/library/ipc/contract.ts`）：

| 方法                       | 说明                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `getSettings()`            | 当前 `WriterSettings`                                               |
| `setSettings(s)`           | 整份保存，返回生效值；模板不合法以 invalid-params 拒绝并指明字段    |
| `write(itemIds)`           | 排写出任务 → `{ jobId }`；传季 / 集按所属剧集处理，未识别的条目跳过 |
| `previewOrganize(itemIds)` | → `OrganizePlan { planId, entries, unchanged }`                     |
| `applyOrganize(planId)`    | → `{ batchId, jobId }`；整理未开启 / 计划过期 / 无可执行项时拒绝    |
| `undoOrganize(batchId)`    | → `{ jobId }`；只能撤销 done / partial / failed 的批次              |
| `listOrganizeBatches()`    | 最近 50 个批次，新的在前                                            |

事件 `writer-progress`（250 ms 节流，`finished` 收尾）：`{ jobId, mode: write | organize | undo, batchId?, total, done, written, skipped, failed, error? }`。
写出完成后不发 items-changed（条目元数据没变）；整理 / 撤销完成后对涉及条目发 items-changed。
item id 与其他接口一致用 number。

## 已知限制

- 整理按文件逐个移动，独占文件夹没有整体改目录名（同盘时一次 rename 更快）；电影文件放在子目录（`Movie/CD1/x.mkv`）时只搬视频所在目录。
- 电影条目的 local_key 仍是旧文件名解析出的片名；整理后若解析版本升级触发重解析，可能按新文件名重新分组（与 P2 移动识别的行为相同）。
- 只用 TMDB 元数据，不写 `<fileinfo>`；季缩略图（landscape）TMDB 没有，没写。
- 跨盘检测只是预览提示（比较两边目录的设备号，overlayfs 等文件系统对文件与目录报不同设备号，所以比较目录），执行时以 EXDEV 为准。
- Windows / macOS / NAS（SMB）真机上的 rename 语义、大小写只改名、长路径（未启用 LongPathsEnabled）需要实测。
- 图片缓存仍不做容量回收（P3 遗留）；写出层复用缓存，删掉缓存文件时会重新下载。
