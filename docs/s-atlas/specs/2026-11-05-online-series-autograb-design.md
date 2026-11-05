# 在线剧追更：点「追更」时在片库建占位剧条目

日期：2026-11-05　状态：设计已定（方案由用户选定），随 ADR-0049 落地

## 目标

追剧日历「在线追剧 · 更新日期未知」那一排的剧来自继续播放的在线记录，不在片库里，追更（`src/main/autograb`）
又完全按片库剧条目 id 工作，所以没有入口。点「追更」时：用剧名匹配 TMDB → 在片库建一个没有文件的**占位剧条目**
→ 打开现有 `SeriesGrabSheet`，后面全走现有追更流程（日历出播出表、搜 115、转存、入库）。

## 核心数据：占位条目

不加列、不迁移（别的会话也在加迁移，且降级会被版本检查拒绝）。占位条目就是一行普通 `media_items`：

| 字段                      | 值                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `type`                    | `series`                                                                                     |
| `local_key`               | `placeholder:tmdb:<tmdbId>`（唯一键，天然幂等；同一部 TMDB 剧最多一个占位）                  |
| `tmdb_id` / `match_state` | 匹配到的 id / `locked`（回收 `GC_SQL` 只收未锁定的，所以不会被扫描清掉；自动识别也不会覆盖） |
| `library_id`              | id 最小的 `kind='tv'`、`source='tmdb'` 媒体库；没有则报错「先添加剧集媒体库」                |
| 无 `file_media`、无子条目 | 「没有文件」                                                                                 |

占位条目因 `merge_key = series:<tmdbId>` 自动和之后扫进来的真实条目合并：日历 `SERIES_SQL` 取同键里 id 最小者（即占位），
`MEMBERS_SQL` 把真实条目的本地集都算上，所以转存入库后日历里直接显示「可播放」，追更的 `seriesId` 全程不变。

## 回答的问题

**怎么建、怎么标记**　新 RPC `calendar.ensureSeries`（引擎）：

1. 同 TMDB id 已有真实剧条目或占位 → 直接返回它（取日历会用的那个，id 最小）；这就是和片库去重。
2. 否则建临时行（`placeholder:pending:<随机>`，未匹配）→ 走现有 `applyMatch`（`{tmdbId, lock}` 或 `{query:{title,year}}`）。
   `matched` → 改 `local_key` 为 `placeholder:tmdb:<id>`、置 `locked`；再检查一遍步骤 1 的并发重复。
3. `review` / `unmatched` → 删临时行，返回候选（至多 6 个）；任何异常也删临时行。

**怎么不污染电影 / 剧集页**　海报墙查询 `compileWhere`（`where-sql.ts`）加一条
`i.local_key NOT LIKE 'placeholder:%'`——去重子查询用同一套条件，所以真实条目出现后由真实条目代表，没有真实条目时墙上没有它。
详情页的「版本」成员（`MergeStore.membersOf`）排除占位（除非查的就是占位自己）。日历、追更、`getItem` 照常能找到它。
点日历里这部剧的行仍可打开详情页（空剧，只有元数据）。

**TMDB 匹配失败或多结果**　渲染层收到候选时在「追更」旁弹一个小选择面板（UiListRow 列：海报、片名、年份），
选中后用 `tmdbId` 再调一次；无候选 / TMDB 未配置 / 没有剧集库都给明确 toast，不建任何东西。

**「继续播放」里在线记录与片库去重**　本次运行里点过追更的，渲染层内存里记「记录 id → 片库剧 id」；重启后按剧名相同对应
（忽略空白与大小写）。不落盘：设置项要登记在共享 schema，不值得；对不上时再点「追更」，建条目幂等，会回到同一部剧。
日历构造条目时：对应的片库剧在当前区间已有播出集 → 丢掉那张在线卡（片库卡更准）；
没有（区间内无新集）→ 在线卡保留，状态标记换成「追更中」并可点开侧板。继续播放页本身不动。

**用户删除时**　占位条目不出现在任何墙，没有删除入口。「停止追这部剧」只把追更方式设为不追；占位条目留着
（无害：不占墙、不出现在日历外），再点追更按 `local_key` 复用同一条。用户删除所在媒体库会级联删除。
真实剧后来入库不需要清理占位。**不做**自动清理占位（有已知后果：库里留无用空行），列为后续。

## 追更入口（UI）

`CalendarRow`：在线剧行（`group.primary.online`）加一个与状态并列的按钮，沿用现有 `.cal-status.is-action` 的样式：
未追 →「追更」；已建且方式非「不追」→「追更中」。点未追 → 调 `autograb.trackOnline` → 成功后打开 `SeriesGrabSheet`
（`seriesId` + 在线剧名）。`autograbAvailable` 为假（网页端）不显示。

## 自动追更页的搜索入口

自动追更页工具栏下加一个搜索框（`SeriesSearchBox`）：输入剧名回车 / 点「追更」，调同一个 `autograb.trackOnline({title})`——
剧名够确定就直接建条目并开侧板，对不准弹同一个候选面板，TMDB 找不到 toast 提示。不要求剧在片库或继续播放里。
日历在线剧行与这个搜索框共用 `useOnlineTracking` 和后端动作；没有新增后端接口（候选搜索就是 trackOnline 的 choose 分支）。

## 契约与改动面

- 引擎：`contract-calendar.ts`（`calendar.ensureSeries` 类型 + 方法白名单）、`validate-calendar.ts`、`engine/rpc.ts`、
  新 `library/calendar/placeholder-series.ts`；`ipc.test.ts` 方法清单。
- 主进程：`shared/contract/autograb.ts` 新增 `trackOnline`（`{title, year?, tmdbId?}` → `{ok, seriesId} | {ok:false, error} | {choose, candidates}`），
  `autograb/index.ts` 实现（只转调引擎）。渲染层只经 autograb 契约，不碰库桥。
- 渲染层：`features/autograb`（`use-online-tracking.ts`、候选选择）、`CalendarRow.vue`、`CalendarView.vue`、`calendar-rows.ts` 去重。

## 测试

引擎：占位创建 / 幂等 / 与真实条目合并 / 匹配失败回滚 / 墙查询不含占位 / `membersOf` 排除；
渲染纯规则：在线卡去重、状态文案；契约解析。
