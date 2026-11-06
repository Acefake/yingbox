# 网络优化第一阶段实现计划

基于已批准的 network-optimization-proposal，主任务在当前工作区执行，不提交或发布。

1. 在 shared/network 定义 NetworkPreferences（githubMode、mirrors、tmdbMode）、默认端点与输入解析；settings schema 和 server-keys 登记单一配置键 network.optimization。编写 tests/network-optimization.test.ts 验证端点选择、凭据边界、取消及状态码回退。
2. GitHub mirrors 接收配置，API 仅使用已验证支持 API 的端点，Raw/Release 使用按顺序启用的端点；官方 429 不切换。桌面更新与服务端更新读取当前配置，Android 原生下载读取设备配置。fetch-first 对自定义目标保留公网校验。
3. shared/network 提供 TMDB GET 回退执行器，online 引擎经 host 读取配置；library platform fetch 经宿主注入配置；NAS metadata 与主进程 TMDB 调用接入。仅网络错误、5xx 回退，401/403/429 原样返回，不改变其他服务。
4. settings 增加固定目标探测接口，服务端提供 /api/network/probe，复用既有鉴权。返回端点、用途、状态、时间与错误，不暴露 Token。测试读取公开样本并校验正文类型。
5. Web/桌面 SettingsGroup / SettingsRow 实现网络设置；Android 手机/TV 共用 Compose 设置组，分开本机更新与内嵌服务请求配置。保存失败反馈并保留草稿。使用实色、设计令牌和已有控件。
6. 新 ADR 扩展 0046；执行 pnpm typecheck、pnpm test、pnpm build:nocheck、build:server、build:web、check:style、check:case、check:size，Android 本地单元测试与 Kotlin 编译。自审全部差异和关键调用方，按 requesting-code-review 派一位只读评审，修正后完成交付。

高级传输代理、应用内 DNS、NAS 第二发布仓库不在第一阶段，保留方案中的独立交付边界。没有真实设备时明确 Android/TV 运行验收未完成。
