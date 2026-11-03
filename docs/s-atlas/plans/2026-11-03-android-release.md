# 安卓首版和应用内更新实现计划

目标：交付手机与电视共用的签名 APK，独立发布 `android-v0.1.0`，并完成检查、下载、校验、系统安装链路。方案依 ADR-0037，沿用用户授权的本机实现与发布方式。

1. 补齐 `view.appUpdate` 的版本、文件名、ABI、大小、SHA-256 边界；更新 `tests/android-release.test.ts`，先得到失败证据，再实现并发缓存与严格选包。执行 `pnpm vitest run tests/android-release.test.ts`，预期全部通过。
2. 连接 `ViewApi.appUpdate`、`AppUpdater`、`UpdateController`、`UpdateUi` 与主界面、设置页。后台查询失败不打扰；主线程更新界面，IO 线程下载；安装授权和取消后复用已下载文件；原生 Dialog 隔离遥控器焦点。
3. 新增 `scripts/android-release.mjs`：构建服务端及 ABI 签名 APK，核对版本、签名及 ABI，生成校验清单；发布时先建草稿、上传完成后再公开 Pre-release，保持桌面 Latest。文档写清签名备份和调试包签名差异。
4. 验证：全量 Vitest、TypeScript 检查、Android release 构建和 lint；如出现原有失败，单独记录，不修改无关测试。自审完整差异后派只读独立评审。
5. 模拟器覆盖升级：同一发布签名构建仅供测试的 0.0.9，安装后保存设置；通过正式发布源查询 0.1.0，检查提示和下载校验、授权页、系统安装确认；升级后核对版本和设置。手机与 TV 分别验证界面，ARM 真机未实测必须明确说明。
6. 创建对应源码提交和不可变版本标签，发布 APK；核对公开下载的 SHA-256 与本地产物一致，以及 `view.appUpdate` 对旧版返回更新、对当前版返回 null。
