# 追更转存定位与整理并入已有文件夹 · 设计

决定与背景见 [ADR-0029](../../adr/0029-autograb-target-and-organize-home.md)。证据来自本机《嫁金釵》：
E01–E21 在 `剧集\大陆\嫁金釵 (2026)(1)`，E22–E24 因剧集默认目录 = 影音库（媒体库根）被存到根目录、
整理又在根目录另建 `嫁金釵 (2026)`（organize 第 18 批）。

## 单元

| 单元                        | 位置                                            | 职责                                                          |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `pickSeriesHome`            | `src/main/library/catalog/series-home-rules.ts` | 纯函数：一组（视频路径, 季号）→ 家文件夹与各季文件夹          |
| `SeriesHomeQuery`           | `src/main/library/catalog/series-home.ts`       | SQL：某条目的合并成员（可限同库）下的视频与季号               |
| RPC `calendar.seriesFolder` | 片库契约 / rpc                                  | 给追更：`{ itemId }` → `{ dir, seasons } \| null`             |
| `mkdir` / `exists`          | `src/main/pan115/client.ts`                     | 115 建一层文件夹（已存在则沿用）、核对 cid 还在               |
| `resolveEpisodeCid`         | `src/main/autograb/target.ts`                   | 按 ADR 顺序解析一集的转存 cid                                 |
| 电影子文件夹                | `src/main/autograb/movies/service.ts`           | 默认目录下「片名 (年份)」                                     |
| 整理找家                    | `organize-planner.ts` / `organize-targets.ts`   | `PlannerDeps.seriesHome`，目标并入家文件夹                    |
| 分类文件夹判定              | `src/shared/library/parser/parse-path.ts`       | `folderLayout` 按分类词（`CATEGORY_FOLDER_RE`）认出分类文件夹 |
| 电影版本 / 广告 / 分类基准  | `organize-targets.ts`                           | `movieTargets`                                                |

## 错误处理

- 查询出错、换算 cid、列目录、建文件夹失败：这一集 `failed`，记原因，下一轮或手动重试；不落根目录、不另建文件夹。
- 家文件夹里已有同名目标：沿用现有冲突检查（「目标已存在」），不覆盖。

## 测试

纯规则用例（家文件夹选择、季文件夹、分类文件夹判定、版本 vs 分段、广告排除）；追更 harness 用例（片库位置优先、
手选失效往下、默认目录下建子文件夹、解析失败不落根）；整理用例（新集并入家文件夹）。
各块跑 `pnpm test:affected`，交付前全量。

## 顺序

A 追更定位 + B 电影子文件夹 → C 整理找家 → D 分类文件夹 → E 电影整理。每块单独验证。
