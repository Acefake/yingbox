# 安装和升级 NAS 专用版

NAS 专用版保留原首页，提供片库扫描、刮削、NFO、整理、浏览器播放，以及完整的 115 网盘、磁力离线、自动追更、洗版、电影追踪和入库通知。首页影片卡片可找网盘资源。桌面版使用原来的构建与功能。

## 安装

准备 `docker-compose.nas.yml`，把 `docker/nas.env.example` 复制到它旁边并命名为 `.env`。这两个文件即可部署，不需要把源码放到 NAS。

在 `.env` 填写已发布的 `YINGBOX_VERSION`、`PUID`、`PGID` 和 `YINGBOX_MEDIA_DIR`。UID/GID 使用媒体文件所属用户的值，不能为 0。媒体挂载可写，NFO、整理和网盘入库才能保存结果。

镜像地址为 `ghcr.io/acefake/yingbox-nas`，支持 `linux/amd64` 和 `linux/arm64`。示例固定使用 `1.0.0-nas.1`，Docker 按 NAS 架构选择对应镜像。维护者推送 `nas-v版本号` 标签后，GitHub Actions 构建、发布镜像并验证两种架构的容器。

```sh
docker compose -f docker-compose.nas.yml up -d
docker compose -f docker-compose.nas.yml ps
```

状态显示 `healthy` 后，打开 `http://NAS的IP:31480/`。在设置中填写 TMDB、PanSou/Torznab、115 登录和默认转存目录。片库添加文件夹时选择 `/media` 下的目录。追更、洗版和电影追踪在“追更与洗版”页管理，离线下载在“网盘”页查看。

默认提供局域网访问，未设置访问令牌时局域网内所有人都能操作片库。需要登录时填写 `YINGBOX_SERVER_TOKEN`，至少 24 个随机字符。反向代理部署填写 `YINGBOX_BIND=127.0.0.1`，HTTPS 入口同时填写 `YINGBOX_PUBLIC_ORIGIN`；代理配置见 [完整部署说明](nas.md#反向代理与-https)。

## 升级和回退

先备份 `/config`，记下当前镜像版本；把 `.env` 的 `YINGBOX_VERSION` 换成目标版本，然后执行：

```sh
docker compose -f docker-compose.nas.yml pull
docker compose -f docker-compose.nas.yml up -d
```

配置、缓存、登录与任务记录保留在原卷中。回退时把版本改回原值并重新启动；目标旧版本不兼容新数据库时，恢复升级前的配置备份。不要删除卷来升级。

## 从完整片库服务迁移

先停止原服务，备份配置和缓存；在 `.env` 中把 `YINGBOX_CONFIG_DIR`、`YINGBOX_CACHE_DIR` 指向原目录。容器内的媒体路径必须与原片库记录一致，例如原来 `/media/movies` 对应电影目录，迁移后仍保持该映射。多个独立挂载在 Compose 的 `volumes` 中逐项保留。

CloudDrive2 挂载继续使用 `rslave` 传播，网盘库的存储类型、变更通知和扫描方式见 [CloudDrive2 说明](nas.md#clouddrive2-挂载的网盘)。NAS 专用版不包含 CloudDrive2 或 PanSou，继续使用已有服务地址与挂载。

## 本地构建

源码验证使用 `pnpm build:nas`；服务和网页分别输出到 `out/nas`、`dist-nas`，启动使用 `pnpm start:nas`。本地构建镜像使用：

```sh
docker build -f Dockerfile.nas -t yingbox-nas:local .
```

部署该本地镜像时在 `.env` 设置 `YINGBOX_IMAGE=yingbox-nas`、`YINGBOX_VERSION=local`。它只有当前构建平台的架构。
