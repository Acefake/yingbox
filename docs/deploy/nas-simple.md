# 安装和升级 NAS 专用版

NAS 专用版与完整网页版保持一致，仅移除番号与 AV。提供在线搜索与播放、下载、直播、日历、片库扫描、刮削、NFO、整理，以及完整的 115 网盘、磁力离线、自动追更、洗版、电影追踪和入库通知。桌面版使用原来的构建与功能。

## 安装

准备 `docker-compose.nas.yml`，把 `docker/nas.env.example` 复制到它旁边并命名为 `.env`。这两个文件即可部署，不需要把源码放到 NAS。

在 `.env` 填写 `PUID`、`PGID` 和 `YINGBOX_MEDIA_DIR`，保留 `YINGBOX_VERSION=stable`。UID/GID 使用媒体文件所属用户的值，不能为 0。目录只有属主可读时，PUID 必须是属主；目录对所属组可读时，入口会把该组加进服务进程。媒体挂载目标保持容器内的 `/media`，不要把 `YINGBOX_MEDIA_ROOTS` 写成宿主机路径。媒体挂载可写，NFO、整理和网盘入库才能保存结果。

镜像地址为 `ghcr.io/acefake/yingbox-nas:stable`，公开提供 `linux/amd64` 和 `linux/arm64`，拉取无需登录。Docker 按 NAS 架构选择镜像。Compose 同时启动独立更新服务，每天北京时间 04:00 检查稳定版；有新版时自动拉取并重新部署影盒。

```sh
docker compose -f docker-compose.nas.yml up -d
docker compose -f docker-compose.nas.yml ps
```

状态显示 `healthy` 后，打开 `http://NAS的IP:31480/`。在设置中填写 TMDB、PanSou/Torznab、115 登录和默认转存目录。片库添加文件夹时选择 `/media` 下的目录。电影 / 剧集的库设置提供“添加 115 文件夹”，可选择已登录账号中的网盘目录，扫描并刮削后播放；无需 CloudDrive2 挂载。115 远程库仅手动扫描，不直接写 NFO 或整理网盘文件。离线下载在“网盘”页查看。

默认提供局域网访问，未设置访问令牌时局域网内所有人都能操作片库。需要登录时填写 `YINGBOX_SERVER_TOKEN`，至少 24 个随机字符。反向代理部署填写 `YINGBOX_BIND=127.0.0.1`，HTTPS 入口同时填写 `YINGBOX_PUBLIC_ORIGIN`；代理配置见 [完整部署说明](nas.md#反向代理与-https)。

使用绿联远程 ID 时，`YINGBOX_PUBLIC_ORIGIN` 填远程 HTTPS 地址，不带 `/#/`。该配置同时保留内网直连；需要内网访问时保持 NAS 端口绑定 `0.0.0.0`，两个入口分别登录。

## 已有安装开启自动更新

只需迁移一次。先备份配置目录，记下当前镜像版本，然后用发行包里的新 Compose 替换原文件。在原 `.env` 中把 `YINGBOX_VERSION` 设为 `stable`，保留自己的 UID/GID、端口、令牌及媒体、配置、缓存目录。

不要用新示例覆盖已有数据目录设置。Compose 默认配置目录为 `./yingbox/config`，缓存目录为 `./yingbox/cache`；已有安装使用其他目录时继续填原目录。使用绿联 Docker「项目」时，在原项目中更新 Compose 并重新部署，保留全部自定义挂载。命令行使用：

```sh
docker compose -f docker-compose.nas.yml pull
docker compose -f docker-compose.nas.yml up -d
```

以后不用逐次修改版本号。更新服务仅选择 `yingbox-nas`，不更新自身或其他容器，不启动手动停止的影盒。更新时网页和播放可能短暂中断；镜像下载失败时继续运行当前版本，下次检查重试。

更新服务需要管理 Docker，因此挂载 `/var/run/docker.sock`，不开放管理端口。名称、标签和 scope 限制更新目标，但不是权限隔离。影盒应用本身没有 Docker socket，继续以非 root 用户运行。

## 暂停更新和回退

暂停自动更新可在 Docker 项目中停止 `updater` 服务。命令行为 `docker compose -f docker-compose.nas.yml stop updater`；恢复使用 `docker compose -f docker-compose.nas.yml start updater`。要长期固定版本，把 `.env` 的 `YINGBOX_VERSION` 设为已发布的具体版本号，再执行上述拉取与部署命令。更新服务不会跨标签选择版本。

配置、缓存、登录与任务记录保留在原卷中。更新服务保留旧镜像，不自动清理卷，也不提供自动回退。新版启动失败时，查看影盒容器的健康状态及更新服务日志；需要回退时固定到原版本并重新部署。若旧版本不兼容已升级的数据库，恢复升级前的配置备份。不要删除卷来升级；重要数据应定期备份。

## 从完整片库服务迁移

先停止原服务，备份配置和缓存；在 `.env` 中把 `YINGBOX_CONFIG_DIR`、`YINGBOX_CACHE_DIR` 指向原目录。容器内的媒体路径必须与原片库记录一致，例如原来 `/media/movies` 对应电影目录，迁移后仍保持该映射。多个独立挂载在 Compose 的 `volumes` 中逐项保留。

CloudDrive2 挂载继续使用 `rslave` 传播，网盘库的存储类型、变更通知和扫描方式见 [CloudDrive2 说明](nas.md#clouddrive2-挂载的网盘)。NAS 专用版不包含 CloudDrive2 或 PanSou，继续使用已有服务地址与挂载。

## 本地构建

源码验证使用 `pnpm build:nas`；服务和网页分别输出到 `out/nas`、`dist-nas`，启动使用 `pnpm start:nas`。本地构建镜像使用：

```sh
docker build -f Dockerfile.nas -t yingbox-nas:local .
```

部署该本地镜像时在 `.env` 设置 `YINGBOX_IMAGE=yingbox-nas`、`YINGBOX_VERSION=local`。它只有当前构建平台的架构。

## 本机发布稳定版

维护者在本机登录 GHCR 后构建并推送明确版本的双架构镜像，不需要 GitHub Actions。例如：

```sh
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.nas --push -t ghcr.io/acefake/yingbox-nas:1.0.0-nas.2 .
node scripts/nas-release.mjs 1.0.0-nas.2
```

发布工具先锁定候选索引摘要，匿名拉取两种架构，并逐一运行健康、非 root 和 NAS 接口冒烟检查。这些候选检查全部成功才将 `stable` 指向相同索引，随后再次核对稳定标签和匿名拉取结果。候选检查失败不会推进 `stable`；提升后的核验失败会报错，但不会自动回滚，应依据输出的前后摘要检查并恢复标签。每次使用新版本号，不覆盖已发布版本。涉及数据库迁移时，还需在发布前验证升级与备份恢复，工具不替代兼容性检查。

自动更新部署包首次使用已验证的 `1.0.0-nas.1` 应用镜像。运行 `node scripts/smoke-nas-update.mjs` 可在独立 Docker-in-Docker 环境复验自动升级、数据保留及故障行为；该验证需要本机 Docker 允许启动 privileged 测试容器，不使用用户的媒体、账号或宿主 Docker socket。
