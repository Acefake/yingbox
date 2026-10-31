# 在线引擎（`src/engine/`）细节

AGENTS.md「Engine」一节只留入口和规则，这里放各域的实现细节。决策见 ADR-0006（下载续传）、ADR-0007（空闲退出）、ADR-0014（插件隔离）。

## 豆瓣浏览（`online` 域）

- 首页无需 TMDB Token：列表直接显示豆瓣封面、评分、年份和分类。`online.doubanMetadata(id, kind)` 按数字 ID 补简介、演职员、时长和剧照，复用 rexxar / frodo 回退；成功缓存一小时，失败冷却 30 秒，并发请求合并。
- 首页每批前五项补轮播信息，其他条目打开详情时加载；横图缺失时按原比例展示海报。TMDB 是可选增强，未配置或请求失败保留豆瓣内容，播放源搜索不等待元数据请求。

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

## 启动时数据源检测

每次启动在应用壳挂载后后台检测全部已配置来源，包括上次关闭的内置 CMS、自定义／订阅 CMS 和插件。清单加载失败时继续检测缓存来源；单个来源成功便启用，失败便关闭，不删除地址或自定义配置。成人 CMS 与插件只在成人模式开启时检测。

CMS 以真实列表响应判定，插件以实际搜索接口返回的列表判定，空列表可用，错误页或缺失列表不可用。CMS 请求限时 8 秒，插件限时 45 秒，整轮最多并发 6 个来源。插件检测携带 `background: true`，不调用浏览器代抓，也不会弹出站点验证窗口；正常前台请求仍支持浏览器代抓。

连接后台失败不当作来源失效，保留开关。连接中断、来源被删除、关闭成人模式或应用壳卸载后，过期结果不再改开关；重连后重新完成全量检测。启动轮次进行中的重复刷新共用任务。

打开数据源面板和每分钟的到期复测沿用健康缓存，不自动覆盖手动开关。手动选择保持到下次启动；面板注明启动自动启停规则。检测基于用户当前运行网络，不使用开发沙箱的境外探测结果修改源清单（ADR-0003），也不自动解除主机熔断（ADR-0004）。
