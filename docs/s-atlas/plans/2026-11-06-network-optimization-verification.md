# 网络优化第一阶段交付记录

日期：2026-11-06。基线 HEAD：`4b41b95f60b1b26ce9cc738c03a2a389f46a0f6e`。改动未提交、未发布。

## 已实现

- 设置 → 网络优化：GitHub 官方/自动回退，三个内置镜像、添加/移除/排序、自定义 HTTPS 地址；TMDB 自动/主/备用 API；明确保存和固定公开样本检测。
- 桌面与 Web/NAS 使用相同设置组件，Web 配置写服务端；Android 手机/TV 使用共用 Compose 设置，内嵌服务与原生 APK 下载分别读取各自存储。
- 在线引擎、插件 Raw、片库刮削、NAS 元数据、电影追踪、回顾元数据和更新下载接入策略。非目标服务保留原路径。API 镜像能力按已验证范围限制。
- 公网及重定向校验、跨源敏感头清除、外部取消和鉴权/限流不换源；大附件下载继续由更新器空闲超时控制。
- ADR-0051 登记在 AGENTS 索引；移除重复的 build:win:full 别名说明以保持入口文档预算，没有提高预算。

## 验证

- 聚焦 Vitest：13 个文件、106 项通过，覆盖端点选择、设置草稿保存、鉴权隔离、SSRF、取消、35 秒连续下载和异步离开确认。
- ADR 与入口文档预算：2 个文件、56 项通过。
- Android：Kotlin debug 编译、68 项单元测试通过；`pnpm build:android` 成功。
- 桌面 `build:nocheck`、`build:server`、`build:web`、`build:nas` 成功。Node 与 Web 类型检查通过。
- 完整 typecheck 在测试层仍失败：`tests/server/view-compose.test.ts` 缺少 logo、`tests/server/view-probe.test.ts` 缺少 hasDirect。未修改 HEAD 快照运行同一检查得到相同两项错误。
- 最后一次全量测试：4310 通过、20 失败、11 跳过，另有 2 个测试文件导入失败；其中新增 ADR 的两项失败已修正并通过聚焦复测。其余包括预加载接口清单漂移、既有 UI 测试、Windows 权限、容器入口与存量门禁，不能标为全量通过。
- HEAD 快照聚焦复测 6 个既有失败文件：预加载清单、check:size、copy-final-state、目录权限和托盘文案断言共 10 项同样失败。本次未改这些业务实现来迁就断言。
- 改动文件 ESLint、check:style、check:case、diff 空白检查通过。check:size 的 6 个超限文件、check:copy 的命中均为任务外存量，不提高基线或预算。
- 本机实际运行公开网络检测：GitHub Raw/小型 Release/API 和 TMDB 两个 API/PNG 样本均可达；未发送 Token。结果只代表本机当前请求栈和网络，不能证明无代理直连或其他设备可用。
- 用临时 Electron/Vite 装置渲染真实设置组件，728/390 宽度未横向溢出；已检查深色截图和浅色计算样式。隐藏窗口的浅色截图存在绘制缓存现象，未将该截图当作完整浅色视觉验收；最终一次装置重跑未就绪，不宣称完整应用 E2E 通过。

## 产物

调试 APK：`android/app/build/outputs/apk/debug/app-debug.apk`（约 108 MB）。已检查 APK 内 `assets/server.zip` 包含 `/api/network/probe` 与 `network.optimization`，嵌入 server.js 的 SHA-256 与本次 staging 文件一致。

本任务没有安装 APK、运行真实手机/TV、完整下载安装更新包、执行真实 NAS docker pull。没有改系统 hosts/DNS、Docker daemon 或用户运行配置。

## 自审与独立评审

自审覆盖全部任务差异、设置契约、宿主注入和直接调用方。独立只读评审发现“下载固定 30 秒中断”和“Promise 离开确认被同步判断放行”两项问题；已修复，新增回归通过，评审者复查确认修复有效，未发现修复引入的明确问题。

原有未跟踪文件 `android/gradle/gradle-daemon-jvm.properties` 与 `design/logo/yingbox-wordmark-purple-concept.png` 保留。基线复测触发了包管理器重建共享依赖；当前依赖按现有锁文件恢复，Electron 45.1.0 可执行文件已恢复，没有修改依赖声明或锁文件。

## 后续边界

高级传输代理、应用内 DNS 优化、NAS 第二发布仓库与 Docker 配置帮助保留在方案后续阶段。本阶段不提供 SOCKS5、公共 TMDB Token 反代或影盒 GHCR 镜像可用性承诺。
