# CMS 源改为内置订阅

日期：2026-11-04　状态：待审阅（已按讨论改为双订阅 + 成人站入 AV）

## 目标

删除写死的 `cms-sites.json`（33 站），CMS 站点只来自两处：**内置订阅**与**用户自定义**。订阅机制内置、地址固定，随包带一份快照做离线兜底，各来源按 api 去重。

## 已定决策

- 订阅地址固定为内置默认值，设置页去掉地址输入框，保留「立即更新」。
- 订阅改为「主源 + 备源」两个固定地址：主源 DaLongZhuaZi/moontv-config `config.json`（约 101 站），备源 hafrey1/LunaTV-config `LunaTV-config.json`（约 69 站）。一个失败用另一个，都成功则并集去重。
- 订阅里的成人站（名字含 🔞，或 `is_adult` 为真）不进普通源，改入 AV 板块（见下）。
- 老用户原有 33 站里不在订阅中的，从启用列表清掉，不转成自定义。
- 新开 ADR 取代「内置清单」决策（引用 ADR-0032、ADR-0046）。

## 数据模型

站点唯一键为规范化 api：小写主机、去 `www.`、去末尾 `/`。

```
CmsSite { name, api }
来源优先级：自定义 > 订阅缓存 > 随包快照
有效站点 = 按规范化 api 去重后的并集，同键取优先级最高者的 name/api
```

- 实现取舍：`DEFAULT_SITES` 即随包快照，`subscribedSites` 是订阅里快照与自定义之外的新增站，设置页把两者合并为一个「订阅源」分组。老用户一次性迁移用 `src/shared/online/legacy-cms.ts` 里的旧内置清单。
- 启用列表 `online_selected_sites` 仍按 api 字符串存，读取时按规范化键匹配，不丢开关状态。

## 组件

1. `scripts/gen-cms-snapshot.mjs`：拉默认订阅，去重后写 `src/shared/online/cms-snapshot.json`（桌面、服务端共用）。发布前手动跑，产物提交入库。默认不测活：开发机网络的探测结果不改站点清单（ADR-0003），失效站由应用启动检测自动关闭。
2. `utils/subscription.ts`：新增 `siteKey()` 与 `mergeSites()`，沿用现有 `parseSubscription`；订阅地址常量保持，不再读 `subscriptionUrl` 存储。
3. `composables/cms-sites.ts`：去掉对 `cms-sites.json` 的导入，`DEFAULT_SITES` 来自合并结果；老用户启用列表迁移（清掉不在有效站点里的内置旧项）。
4. `composables/cms-subscription.ts`：固定地址；拉取失败沿用缓存，无缓存用快照；不再用「known 内置」过滤，改走 `mergeSites`。
5. `components/SubscriptionSection.vue`、`OnlineSourcesTab.vue`：去掉地址输入，标题「内置 CMS 源」改为「订阅源」，数量取有效订阅站点。
6. `src/server/view/index.ts`：改读快照（服务端暂不联网拉订阅，安卓经服务端拿默认站点，行为随快照更新）。
7. 删除 `cms-sites.json`；更新 `AGENTS.md`、ADR-0032 描述，新增 ADR。

## 成人站进 AV 板块

- `parseSubscription` 返回 `{ ordinary, adult }` 两组；判定成人：`is_adult === true` 或名字含 🔞。
- `adult` 组经 `useAvSources().addSources()` 写入 `av_remote_sources` 并默认启用；该函数已按 api 去重，且不影响写死的 `AV_SOURCES`。
- 普通 CMS 的 `ORDINARY_CMS_APIS` 排除规则保持：订阅里的普通站不会误入 AV。
- `av_remote_sources` 还有其他来源（在线清单、手动添加），订阅里消失的成人站不自动清理，用户可在 AV 源面板手动停用。
- NAS 版 AV 关闭（`nas/av-disabled.ts`），成人站只在桌面渲染层处理，不进服务端快照。
- 成人站依然由现有成人模式与启动检测控制是否启用，不新增开关。

## 快照补充

- 随包快照额外并入已确认可用的普通站 `huyazy.net`、`www.ckzy1.com`（订阅里没有）。

## 错误处理

- 订阅拉取失败：保留缓存；无缓存退回快照；两者都空才显示无源。
- 订阅内容为空或格式不识别：视为失败，不覆盖缓存（沿用现有行为）。
- 快照脚本中失败站点直接丢弃；脚本整体失败不写文件。

## 测试

- 成人站拆分：🔞 与 `is_adult` 两种标记都识别；普通站不误入 AV；AV 去重与刷新清理。
- `siteKey` / `mergeSites`：大小写、`www.`、末尾 `/`、优先级。
- 订阅同步：成功、失败沿用缓存、无缓存用快照。
- 迁移：旧内置站在订阅中保留开关，不在订阅中被清掉。
- 服务端默认站点读快照。
- 现有 `cms-subscription-state`、`online-search` 测试按新数据流调整。

## 不做

- 不让用户改订阅地址，不做多订阅。
- 不在服务端联网拉订阅。
- 不新增镜像或代理。
