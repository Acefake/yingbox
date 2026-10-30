# NAS 自动更新实现计划

> **执行方式：** 主任务使用 executing-plans 执行，完成后派只读子代理评审。

**Goal:** NAS 使用稳定版镜像自动升级，用户不再逐次修改版本号。

**Architecture:** NAS Compose 同时部署影盒和固定摘要的 Watchtower，仅后者获得 Docker socket。影盒跟随 `stable`；本机发布工具验证双架构后更新稳定版标签。

**Tech Stack:** Docker Compose、Watchtower 1.23.2、Node.js 脚本、Vitest。

**验证与授权：** 用户已授权实现、提交推送与仓库发布。涉及 Docker 管理权限和发布脚本，按第 3 档验证。部署行为使用隔离 Docker daemon 实测；发布边界使用聚焦单元测试。桌面和 NAS 应用代码不改，沿用已验证应用镜像。

## 全局约束

- 复用 `codex/nas-release` 隔离工作区，基线 `0af49e7b`，保留其他工作区修改。
- 默认 `stable`，可用 `YINGBOX_VERSION` 固定版本；默认每天北京时间 04:00 检查。
- 更新服务镜像使用 `ghcr.io/nicholas-fedor/watchtower:1.23.2@sha256:62fb91130ddb493f869cad7e198fa260dd16c5da293ed092cbd5d8781566f7a6`。
- 仅更新名称、enable 标签、scope 三者同时匹配的 `yingbox-nas`；不启动已停止容器，不删除镜像和卷。
- 使用本机发布，不触发 GitHub Actions；发布部署包的新标签采用 `nas-auto-update-v1`。
- 初次 `stable` 复用 `1.0.0-nas.1`，索引摘要必须保持 `sha256:9851bc7f90e5666a61a92ba9b8b93ed1975f55db95b5b71539cdee18c3873c7e`。

## 任务 1：部署入口和发布边界

**Files:** 修改 `docker-compose.nas.yml`、`docker/nas.env.example`；新增 `scripts/nas-release.mjs`、`tests/deploy/nas-release.test.ts`。

**Interfaces:** `node scripts/nas-release.mjs <version>` 验证版本镜像、运行 amd64/arm64 容器检查，再提升 `stable`；无额外依赖。导出版本和索引校验函数供测试使用。

- [x] 将 image 改成 `${YINGBOX_IMAGE:-ghcr.io/acefake/yingbox-nas}:${YINGBOX_VERSION:-stable}`。
- [x] 添加 enable/scope 标签、60 秒停止等待；更新服务配置 `WATCHTOWER_LABEL_ENABLE=true`、`WATCHTOWER_SCOPE=yingbox-nas`、`WATCHTOWER_SCHEDULE=0 0 4 * * *`、`WATCHTOWER_TIMEOUT=60s`，命令参数指定 `yingbox-nas`，不给应用 Docker socket。
- [x] 发布脚本只接受 NAS 版本号，先解析不可变索引摘要并验证 linux/amd64、linux/arm64，所有后续验证和提升均使用该摘要。使用临时容器检查健康、非 root 和 `docker/smoke-nas.mjs`，退出时只删除脚本自己创建的容器及其匿名卷。验证失败不更新稳定标签。
- [x] 为错误版本、缺失架构、错误摘要和允许的双架构索引编写单元测试；运行 `pnpm exec vitest run tests/deploy/nas-release.test.ts`。

## 任务 2：真实更新验证

**Files:** 新增 `scripts/smoke-nas-update.mjs`。

**Interfaces:** `node scripts/smoke-nas-update.mjs` 创建独立 Docker-in-Docker 环境和测试仓库，读取生产 Compose 生成更新服务配置，完成后仅清理自身环境。

- [x] 读取 `docker compose -f docker-compose.nas.yml config --format json`，断言默认 stable、socket 仅在更新服务、时间与筛选配置有效。
- [x] 用临时 Docker daemon 运行当前真实 NAS 镜像及同镜像的对照容器，给 `/config` 写入标记并创建测试片库。
- [x] 向隔离仓库发布改变镜像标签的测试新版；运行一次实际更新服务，确认影盒容器 ID 改变、健康恢复、片库和文件保留，对照容器 ID 不变。
- [x] 无更新时 ID 不变；仓库不可用时旧实例保持运行；手动停止时不被启动。记录日志和断言，失败退出非零。
- [x] 分别运行两种架构的更新服务 `--help`，确认镜像可启动。

## 任务 3：文档、自审与独立评审

**Files:** 新增 `docs/adr/0025-nas-stable-auto-update.md`；修改 `docs/deploy/nas-simple.md`；补充执行记录。

- [x] 写明首次部署、已有安装一次迁移、固定版本与关闭更新的方法，保持原来的数据挂载路径。说明 Docker 权限、短暂中断、无自动回退，以及旧数据库恢复要求。
- [x] 更新文档发布方式为本机验证与提升稳定标签，不依赖 Actions。
- [x] 运行格式检查、改动脚本 ESLint、`pnpm typecheck`、`pnpm test`、NAS 构建和部署冒烟、样式/大小写/大小检查，复用仍有效结果，不为部署改动重新打包桌面 EXE。
- [x] 自审完整差异和失败路径，按 requesting-code-review 派只读评审，修复发现后复审相关部分。

## 任务 4：发布与交付

**Files:** 生成 `D:/soft/yingbox/dist/nas-auto-update-v1/` 下的 Compose、`.env`、中文 README、校验文件和部署 ZIP。

- [x] 运行 `node scripts/nas-release.mjs 1.0.0-nas.1`，记录稳定标签与版本索引/平台摘要一致，匿名拉取验证通过。
- [x] 检查部署包与旧版配置目录布局一致、无账号和令牌；使用明确路径提交本次文件并推送 `codex/nas-release`。
- [x] 在 `Acefake/yingbox` 创建 `nas-auto-update-v1` Release，目标为本次提交，上传部署 ZIP、校验文件和验证记录，避免把 NAS Release 标记为 Windows 更新的 Latest。
- [x] 核对远端附件大小和摘要、Release 目标提交及稳定镜像；交付仓库下载链接和一次迁移步骤，明确尚未登录用户 NAS 真机部署。
