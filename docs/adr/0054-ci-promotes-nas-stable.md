# ADR-0054 发布流水线推进 NAS 稳定版标签

- 日期：2026-11-06
- 状态：已采纳
- 部分取代 ADR-0025 中「由本机发布工具推进 stable」的做法。

## 背景

ADR-0025 规定 NAS 用户跟 `ghcr.io/acefake/yingbox-nas:stable` 自动更新，`stable` 由本机工具
`scripts/nas-release.mjs` 在两个架构都验证通过后推进。

实际执行下来，这个环节被漏掉了：`stable` 从 1.0.1 之后就没有再推进，
1.0.2 到 1.0.6 只产出了 `1.0.x-nas.1` 这样的版本标签。后果是

- `docker-compose.nas.yml` 默认写 `YINGBOX_VERSION=stable`，所有按文档部署的用户永远停在 1.0.1，
  自动更新服务每天检查都发现不了新版本；
- 本机推进要求开发机装 Docker 并登录有 GHCR 推送权限的账号，换机器或换人时容易断档；
- 发布流水线本身已经推送了版本标签，却没有推进浮动标签，两件事分开做才产生了断层。

## 决策

由发布流水线（`.github/workflows/release.yml`）在推送版本标签那次运行里推进 `stable`。

- 每个架构在自己的原生 runner（`ubuntu-latest` / `ubuntu-24.04-arm`）上构建完成后，
  立即用刚构建出的摘要启动容器，检查健康状态、PID 1 非 root、NAS 接口冒烟。
  这不是跨架构模拟，跑的就是该架构真机。
- `nas-manifest` 合并出双架构索引后调用 `promoteNasStable`，把 `stable` 指向同一个不可变索引，
  再核对提升后的摘要，不一致就失败。
- 验证与推进逻辑放在 `scripts/nas-release.mjs`，CI 与本机共用同一份实现，
  避免两边规则漂移。`verifyNasImage` / `promoteNasStable` 是导出函数，`verifyNasImage`
  在 CI 里不带 `--platform`，本机发布保留 `--platform` 与匿名凭据验证。
- 本机 `publishNas` 保留：它额外用无凭据的 Docker 配置匿名拉取两个架构，
  验证公开可拉取，这一步 CI 里由流水线自身的登录态覆盖。两条路都能推进 stable，互不冲突。
- 演练（`workflow_dispatch`）只构建和验证，不推送、不推进 stable。

## 后果

- 发版推 `vX.Y.Z` 标签后，`stable` 自动跟到 `X.Y.Z-nas.1`，NAS 用户次日 04:00 自动更新，
  不需要任何人再改版本号。
- 推进前的验证从「开发机手动跑」变成「每次发版必跑」，验证只会更多不会更少。
- 推进失败会让整个 release job 失败，版本标签仍已推送，需要人工检查后重新推进或回退
  （与 ADR-0025 一致，不提供自动回退）。
- 构建阶段的验证会多花掉每个架构约半分钟到一分钟的容器启动时间。
- 本机 `scripts/nas-release.mjs <version>` 仍可手工推进，用于流水线故障后的补救。

## 否决方案

- **继续只靠本机推进**：正是这个环节被漏掉了五次发版，且依赖开发机环境。
- **构建阶段直接推 `stable`**：两个架构是并行构建的，任一架构失败会留下指向单架构或半成品的
  `stable`，等于把构建故障直接推给自动更新用户（ADR-0025 已否决过跟随未验证镜像）。
- **合并后才在 x86 runner 上跨架构验证 arm64**：模拟执行验证不到真实指令集和内核差异，
  而流水线本来就有 arm64 原生 runner。
- **让 NAS 端主动查询 GitHub Release 判断新版**：容器更新仍需外部 pull，
  多一套版本判断逻辑而没有实际收益。
