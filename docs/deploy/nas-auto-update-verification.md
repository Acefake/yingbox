# NAS 自动更新发布验证

日期：2026-10-30。开发基线：`0af49e7b2817c6d8d7225009406c7a787ccce392`。本次仅增加 NAS 部署、发布工具和说明，`src/` 与基线无差异，桌面程序未重新打包或更改。

## 已发布镜像

- 稳定标签：`ghcr.io/acefake/yingbox-nas:stable`。
- 对应应用版本：`1.0.0-nas.1`。
- 多架构索引：`sha256:9851bc7f90e5666a61a92ba9b8b93ed1975f55db95b5b71539cdee18c3873c7e`。
- amd64：`sha256:8a0928287f2cf830ad23581c89722ab2bf5f7df3424b32525bcb1eb557589591`。
- arm64：`sha256:ddebf819d2ef7ee0160b26175a775b8f5ee87ccef17290cb7f3d8b4a89f2584a`。

`node scripts/nas-release.mjs 1.0.0-nas.1` 退出 0。发布前，使用全新、无仓库凭据的 Docker 配置匿名拉取候选的两个架构，逐一验证健康检查、PID 1 非 root 和容器内 NAS 功能冒烟。发布后再次匿名拉取两个架构的 stable 并确认索引摘要一致。匿名连接与当前 Docker daemon ID 相同。

## 自动更新实测

`node scripts/smoke-nas-update.mjs` 退出 0，使用独立 Docker-in-Docker daemon、临时镜像仓库和临时数据，没有读取用户的真实媒体或登录资料。更新器使用实际部署的固定版本与摘要，连接测试 daemon 的 socket。

- 真正替换影盒容器后，容器 ID 改变，健康状态恢复，配置目录标记和经 RPC 创建的片库记录保留。
- 具有相同更新标签但名称不同的对照容器 ID 不变。
- 没有新版时不重建。
- 仓库不可用时旧实例继续运行。
- 手动停止影盒后，不启动或替换该容器。

真实更新会话记录为 `scanned=1 skipped=0 updated=1`。更新器两个架构分别执行 `--help` 成功；Docker API 协商实测使用 v1.56。arm64 在本机通过模拟执行，不代替 ARM NAS 真机验收。

## 其他检查

- `pnpm typecheck`：Node、网页和测试类型检查通过。
- `pnpm exec vitest run tests/deploy/nas-release.test.ts tests/dev-gates/adr.test.ts tests/dev-gates/context-budget.test.ts --maxWorkers=2`：34 项通过。
- 全量 `pnpm exec vitest run --maxWorkers=2`：3791 项通过，11 项跳过，1 项失败；文件为 413 通过、1 跳过、1 失败。
- 唯一全量失败是 `tests/check-size.test.ts` 检查三个已有源文件超过 400 行：`src/main/library/engine/service.ts` 415 行、`src/renderer/src/features/online/views/OnlineView.vue` 414 行、`src/renderer/src/features/library/LibraryPage.vue` 402 行。计数沿用检查工具，包括结尾空行；三个文件与开发基线相同，本次未修改。`pnpm check:size` 同样未通过，不能宣称全量检查通过。
- 改动脚本和测试 ESLint 零警告；格式、样式令牌、导入大小写和 `git diff --check` 通过。
- `pnpm build:nas` 和 `pnpm smoke:nas` 通过。服务冒烟覆盖网页、鉴权、片库、全部网盘域及元数据，在线引擎和直播接口保持不提供。

## 评审与限制

实现者自审覆盖全部任务差异、部署权限、候选验证、稳定标签提升和迁移路径。只读独立评审提出的匿名拉取、Docker context 和提升后错误说明问题均已修正并复核，无新增发布阻断项。

当前没有登录用户 NAS 进行安装。已有项目仍需替换一次 Compose 并使用 stable，同时保留原挂载。更新服务具有 Docker 管理权限，筛选规则不等于权限隔离。更新会短暂中断连接，不提供自动回退；数据库升级后可能需要配置备份才能回退。
