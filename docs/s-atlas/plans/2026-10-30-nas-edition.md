# NAS 专用版实现计划

基线：`e2a23a91760a1284a0a9a1d50161f666abe80119`。当前分支 `codex/upgrade-build-runtime` 有其他任务的未提交修改，保留并在本任务前后差异中区分。主任务执行，不委派实现；交付前按 requesting-code-review 委派只读评审。

设计：[NAS 片库与网盘专用版](../specs/2026-10-30-nas-edition-design.md)。用户已批准范围及桌面不变要求。

## 1. 分离 NAS 服务入口

修改 `src/server/app.ts`，把在线引擎、直播与播放代理登记移入 `src/server/features.ts`，以 `registerServerFeatures(router, registry, deps)` 返回关闭句柄。新增 `src/server/nas/features.ts` 与 `metadata.ts`，登记 `POST /api/metadata/:method`，限定 TMDB、豆瓣片单、榜单、详情与预告片，复用 online 契约参数解析。使用 `createNetClient`、固定 TMDB 源及 Node DNS，不向渲染层返回令牌。预告片代理只接受 HTTPS 的 doubanio.com 公网目标，不开放通用播放代理。

`vite.config.server.ts` 按 `mode === 'nas'` 替换上述组装入口，输出 `out/nas`，省略 `engine` 输入；原构建参数保持不变。测试用依赖注入选择 NAS 登记函数，核对原在线接口缺席、片库/网盘正常、鉴权与非法参数。

## 2. 增加 NAS 网页入口

新增 `src/renderer/src/nas/main.ts`、`App.vue`、`Layout.vue`、`routes.ts`，复用片库页、网盘页、SettingsPanel 与 PlayerModal。新增网盘管理、片库任务页，分别使用 AutograbTabs / AutograbPanel、useActiveJobs。默认首页复用原 HomeHero、GenreRow、DoubanChartRow、HotShelf、CollectionRow、DoubanBrowse 与 useHomeHero，动态货架保留刚入库和待看，首页卡片承接网盘找资源。

新增 `src/renderer/src/nas/metadata.ts`，请求 `/api/metadata`；NAS 构建将在线 feature 公共出口替换为该窄入口，使网盘匹配、库外发现和本地播放不拉入在线聚合模块。`vite.config.web.ts` 的 nas 模式替换 HTML 主脚本并输出 `dist-nas`，支持正常开发代理。

设置注册表只在 nas 模式使用精简分区，保留外观、刮削、浏览器播放、片库、网盘、自动追更与入库通知。桌面使用原分区。保留现有 UI 组件和令牌；在真实页面中核对窄屏导航、设置、任务及错误状态。

## 3. 简化部署

新增 `Dockerfile.nas`、`docker-compose.nas.yml`、`docker/nas.env.example`、`.github/workflows/nas-image.yml`，更新 package scripts 与 NAS 指南。镜像只复制 NAS 构建和运行依赖，默认带 ffmpeg/ffprobe，不带 Electron、mpv、Chromium 或在线引擎。构建流程使用固定版本的构建动作，手动触发并验证标签，发布 amd64/arm64 镜像。默认部署不构建源码，升级使用 compose pull / up；显式版本便于回退。

新增 ADR 记录 NAS 专用功能边界与局域网 Compose 入口，明确局部取代 ADR-0010、0019、0023 的适用范围。旧数据保留，不自动删卷。

## 4. 验证与评审

- 用已有 Vitest 框架增加 `tests/server/nas-edition.test.ts`，从真实 app.fetch 检查接口、鉴权与 netdisk 注册结果；不为纯配置增加镜像实现的测试。
- 运行本地类型检查与相关 server / 网盘 / 片库测试，记录已有失败，不修改无关任务代码。
- 构建 NAS 服务和网页，检查输出模块与接口；再构建桌面，证明默认入口独立。
- 运行改动文件 ESLint / Prettier，仓库 check:style / check:case / check:size。新增 baseline 违规必须修正，不抬预算。
- 使用隔离数据目录启动构建后的 NAS 服务；浏览器检查原首页、电影、网盘、追更、洗版、首页找网盘资源、设置、旧路由重定向及 390px 布局。没有真实账号或 NAS 时明确实机边界。
- 自审完整任务差异和关键调用链，委派只读独立评审，修复后复查。未得到提交或发布授权，不提交、不推送。

## 验证记录

2026-10-30：NAS 服务与网页构建通过，产物模块检查通过；桌面构建、类型检查、任务文件 ESLint/Prettier、样式、文案和导入大小写检查通过。隔离启动后的 `smoke:nas` 通过。首页、豆瓣与 NAS 接口相关 10 个测试文件共 74 项通过。新增预告片接口已覆盖鉴权、目标限制和 Range。

浏览器验证了真实豆瓣首页数据、片名搜索、网盘设置、追更、洗版、电影追踪与手机布局。使用隔离目录生成的 3 秒 H.264 视频完成添加片库、扫描、详情和实际播放，视频解码为 640×360、readyState 4、无播放错误。

一次全量测试为 3814 通过、4 失败、11 跳过。两个新增 ADR 规范问题已修正，ADR 与入口预算等复查 33 项通过；ffmpeg 超时项单独复查 4 项通过。剩余 check:size 失败来自任务前已有的 service.ts 415 行、OnlineView.vue 414 行、LibraryPage.vue 402 行，本任务没有新增超限文件。

自审和独立只读评审已完成，首页恢复与剧集跳转网盘的追加修正也已复查，无 P1/P2 阻断项。未进行 Docker、多架构镜像、真实 NAS 或真实 115 账号验证；未构建容器镜像、未提交、未推送、未发布。
