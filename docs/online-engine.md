# 在线引擎（`src/engine/`）细节

AGENTS.md「Engine」一节只留入口和规则，这里放各域的实现细节。决策见 ADR-0006（下载续传）、ADR-0007（空闲退出）、ADR-0014（插件隔离）。

## 豆瓣浏览（`online` 域）

- 入口 `online.doubanBrowse(query, start)`，实现在 `online/douban-browse.ts`。
- 快捷标签走 `movie.douban.com/j/search_subjects`；带类型 / 地区 / 年代 / 排序 / 最低评分任一筛选时走 `m.douban.com/rexxar/api/v2/<movie|tv>/recommend`。
- 查询参数白名单在 `src/shared/douban/query.ts`；每页缓存 10 分钟，按主机熔断。
- 首页榜单行：`online.doubanChart()` 取一周口碑电影榜（`m.douban.com/rexxar/api/v2/subject_collection/movie_weekly_best/items`，10 部，`online/douban-chart.ts` 把 `subject_collection_items` 换成列表结构），与浏览共用页缓存、熔断和 frodo 回退；失败或为空时渲染层（`use-home-chart.ts`）退回热门电影前 10，标题随之改成「豆瓣热门 Top 10」。
- 渲染层是 `features/online/composables/use-douban-feed.ts`：模块级单例，`UiVirtualGrid` 的 `reach-end` 触发无限滚动，按条目地址去重，查询记在 `sessionStorage`。

## CatSpider 插件缓存

插件的 `$cache` 按插件分开，持久化在 `userData/online/plugin-storage/`（`online/plugin-storage.ts`）：每个插件地址一个文件，30 天过期，每个插件 256 KB 上限，原子写入。

## 下载续传与临时文件（`download` 域）

- HLS 写 `<文件>.partial` + `.partial.segs`；以 `.mp4` 一类扩展名结尾的链接走 `direct.ts`，写 `.partial.json`，用 `Range` + `If-Range` 续传。文件格式和重来规则见 ADR-0006。
- 每个任务第一次开始时记下下载根目录（`DownloadTask.dir`），之后的重试、续传、删除都用这个目录，设置改了也不变；没开始过的任务用当前设置。
- 失败和取消保留临时文件给下次续传；删除任务时一并删掉。
- `queue.load()` 之后，引擎清扫当前根目录和每个任务的根目录（`sweep.ts`），删掉 7 天没动过的孤儿 `.partial[.segs|.json]`。
- ffmpeg 转封装先写 `.mp4.partial` 再改名。
- 主进程启动时读队列文件，有没下完的任务就唤醒引擎（`src/main/engine/pending-downloads.ts`）。
