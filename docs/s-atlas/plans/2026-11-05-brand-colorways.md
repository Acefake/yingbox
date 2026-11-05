# 六色品牌实现计划

设计依据：`docs/s-atlas/specs/2026-11-05-brand-colorways-design.md`，用户已确认推荐方案。

1. 资源与交付：更新 `scripts/export-brand-icons.py`，读取 `design/logo/` 的六种图标原图和中文字标设计稿。导出 `src/renderer/src/assets/imgs/brand/`、Android drawable-nodpi 及默认紫色发布资源。每色输出图标、字标、横向组合的 PNG/GIF/HTML，打包为 `design/exports/yingbox-brand-kit.zip`。静态保留透明背景；GIF 使用深浅固定背景，说明格式限制。
2. 设置行为：在 `src/shared/settings/schema.ts` 增加枚举 `ui.brandColor`，默认 `purple`。为 `tests/settings-store.test.ts` 添加默认值、六种值持久化、非法输入拒绝的行为检查，先确认默认值检查失败，再实现。
3. 网页组件：在 `components/ui/brand.ts` 管理配色与资源映射，改 `UiBrandLogo.vue` 接收 color，新增 `UiBrandWordmark.vue`。调用方 `AppSidebar.vue`、`nas/Layout.vue`、`UpdateScreen.vue` 绑定设备设置。`AppearanceSettings.vue` 增加可访问的实际图标预览选择，复用 UiSelect 和 SettingsRow。
4. 原生端：增加 `ui/BrandColor.kt` 枚举与 CompositionLocal，`DeviceSettings.kt` 保存枚举字符串，`SettingsScreen.kt` 用既有 Pill 展示六种选择。`MainActivity.kt` 提供配色，`Splash.kt` 与首页标志共用映射及字标资源。默认启动器/TV 资源统一紫色，保持系统减少动画支持。
5. 验证与审查：运行设置测试、相关组件/门禁测试、node/web 类型检查、check:style、check:case、目标 ESLint、桌面与 Web 构建、Android Kotlin/资源编译。查看六色静态与动态实际输出，检查 ZIP 文件数、GIF 帧数与循环、透明 PNG 尺寸。自审完整 diff 后派只读独立评审，修复任务内问题。此前已记录的全量失败保留边界。用户随后授权提交、推送并合入主干。


## 验证记录

- 设置/UI/注册/导航/主题相关测试：5 个文件、31 项通过；新增 3 项设置行为测试先失败后通过，另有 1 项真实 Vue 设置切换测试。
- node/web 类型检查、ESLint、样式令牌、import 大小写、设计机械检查通过。
- 桌面、Web、NAS Web 构建通过；Android Kotlin 与资源编译通过。
- 18 张透明 PNG、18 个 4 秒循环 GIF、18 个离线 HTML 验证通过；ZIP 校验通过，含 57 个文件。
- 全量测试：4229 通过、15 失败、11 跳过，11 个失败文件与上一轮相同；新增 4 项全部通过。失败包括已有文件行数门禁、copy 检查、preload 清单、目录权限及缺失模块。没有修改相关实现或削弱断言。
- check:size 仍报告 4 个非本任务文件超行数；check:copy 仍报告 5 个非本任务文件中的 6 处文案违规。测试类型检查此前记录的 3 处错误未作为本任务修复范围。
- 自审覆盖完整任务差异与入口；独立评审发现 TV 设置缺少即时品牌预览，补齐后复查通过。
- 未验证安装后的系统图标、Android/TV 真机或遥控器操作；未把构建或预览替代为实机验收。
