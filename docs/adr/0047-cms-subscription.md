# ADR-0047 CMS 源改为内置订阅 + 随包快照

- 日期：2026-11-04
- 状态：已采纳
- 取代：写死的内置 CMS 清单 `cms-sites.json`（见 [ADR-0032](0032-android-sources-and-playback.md) 对它的引用）
- 参考：[ADR-0003](0003-overseas-probe-not-source-failure.md)、[ADR-0046](0046-update-mirror-fallback.md)

## 背景

手工维护的 33 站里，多数已失效或换域名；jin18 单订阅只有约 27 个普通站，与内置只有 9 个重叠。公开的 LunaTV / MoonTV 订阅每天自动测活，覆盖更广。

## 决策

1. **站点来源只有两类**：内置订阅与用户自定义。删除 `cms-sites.json`。
2. **双订阅，地址固定**：主源 DaLongZhuaZi/moontv-config `config.json`，备源 hafrey1/LunaTV-config `LunaTV-config.json`。至少一个成功即同步，成功的并集去重。设置页不再提供订阅地址输入，保留「立即更新」。
3. **成人站进 AV**：条目 `is_adult` 为真或名称含 🔞 的不进普通源，交给 `useAvSources().addSources()`（按 api 去重，默认启用）。NAS 版 AV 关闭，不处理。
4. **随包快照**：`scripts/gen-cms-snapshot.mjs` 拉同两个订阅，剔除成人站，去重并入补充站，写 `src/shared/online/cms-snapshot.json`；桌面离线时和服务端（含安卓）以它为默认站点。脚本默认不测活，开发机的探测结果不改清单（ADR-0003），失效站由启动检测自动关闭。
5. **去重键**：小写主机、去 `www.`、去路径末尾 `/`；优先级为自定义 > 订阅 > 快照。
6. **老用户一次性迁移**：不在快照与自定义里的旧内置站从启用列表清掉；快照里的新站默认启用，旧内置站保留原开关。旧清单固化在 `src/shared/online/legacy-cms.ts`，迁移标记 `online_builtin_migrated`。

## 后果

- 依赖两个第三方个人仓库；都拉不到时用上次缓存或快照。
- 服务端 / 安卓的默认站点随发版（快照）更新，不实时订阅。
- 订阅里的普通站质量参差，靠启动检测与手动开关兜底；只验证列表接口，不验证真实播放。

## 否决方案

- **只用 jin18 精简版**：与旧内置只重叠 9 站，覆盖明显变窄。
- **保留写死清单再叠订阅**：多数写死站已失效，维护成本不变。
- **快照脚本默认测活**：违反 ADR-0003。
