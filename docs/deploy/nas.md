# 在 NAS 上用 Docker 部署片库服务

片库服务是影盒媒体库（电影、剧集、番号库）的独立 Node 版本，浏览器访问，能扫描、刮削、写 NFO、整理和在页内播放。
它能做什么、不能做什么，以及全部配置项，见 [片库服务](../library-server.md)；为什么这样部署，见 [ADR-0010](../adr/0010-docker-nas-deploy.md)。

镜像里只有 Node 服务和网页端，不含 Electron，amd64 / arm64 都能构建。目前没有发布好的镜像，需要在 NAS 上从源码构建。

## 先知道这几件事

- **默认只有 NAS 本机能访问**：compose 示例把端口映射到宿主的 `127.0.0.1:31480`，给同机的反向代理用。局域网直接访问要把 `ports` 改成 `'31480:31480'`。
- **访问令牌必填**：容器里监听 `0.0.0.0` 时，服务要求 `YINGBOX_SERVER_TOKEN` 至少 24 个字符、不是示例占位串，否则拒绝启动（日志里写明原因）。
- **服务不以 root 运行**：容器以 root 启动入口脚本，把 `/config`、`/cache` 的属主改成 `PUID:PGID` 后降权。`PUID` / `PGID` 设成媒体文件的属主，或者至少是能读这些文件的用户。
- **片库只读挂载**：浏览、扫描、刮削、播放都只需要读。要写 NFO / 图片或整理改名，去掉对应挂载的 `:ro`。

## 目录映射

| 容器内          | 放什么                                                   | 建议                                                                                   |
| --------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/config`       | `library.db`（片库数据库）、`secrets.json`（令牌，0600） | 必须持久化、必须备份；只让服务用户可读                                                 |
| `/cache`        | `media/`（海报原图、缩略图）、`gfriends-index.json`      | 可以放 SSD。缩略图删了会重建；海报原图删了要对条目「刷新元数据」才回来，所以也建议备份 |
| `/media/<名字>` | 片库目录，可以挂多个                                     | 默认 `:ro`。网页端只能在 `/media` 以内浏览和建库                                       |

`./yingbox/` 是 compose 示例的数据目录，已写进 `.gitignore` 与 `.dockerignore`，不会进 git 也不会进镜像。

## 通用步骤

需要 Docker 与 Compose v2（`docker compose version` 能输出版本）。

```bash
git clone https://github.com/Acefake/yingbox.git && cd yingbox
id <媒体文件属主的用户名>        # 记下 uid / gid，填到 docker-compose.yml 的 PUID / PGID
echo "YINGBOX_SERVER_TOKEN=$(openssl rand -base64 32)" > .env
# 编辑 docker-compose.yml：PUID / PGID、片库挂载（/volume1/video/... 换成你的目录）、需要时改端口
docker compose up -d --build
docker compose ps                  # STATUS 里出现 (healthy) 即启动完成，约 30 秒
```

浏览器打开 `http://127.0.0.1:31480/?token=<.env 里的令牌>`（局域网直连时把地址换成 NAS 的 IP），只需第一次带令牌，之后靠 Cookie。

国内网络：

- 拉 `node` 基础镜像慢或失败时，给 Docker 配镜像加速。Dockerfile 用摘要固定了基础镜像，加速源返回的内容不一致会直接报错，不会悄悄换成别的镜像。
- 装依赖慢时，在 compose 的 `build.args` 里设 `NPM_REGISTRY: https://registry.npmmirror.com`（示例里有注释好的几行）。
- 访问 TMDB / 番号站点要代理时，在 `environment` 里设 `HTTPS_PROXY` 等变量，并一起设 `NODE_USE_ENV_PROXY: '1'`，见 [代理](../library-server.md#代理)。

升级：`git pull && docker compose up -d --build`。`/config`、`/cache` 不受影响。

## 群晖（DSM 7.2，Container Manager）

1. 套件中心装 **Container Manager**；控制面板 → 终端机和 SNMP 里打开 SSH（只为查 uid、构建时用，用完可以关）。
2. 在 File Station 建 `/volume1/docker/yingbox`，把仓库放进去（SSH 里 `git clone`，或在电脑上下载 zip 后上传解压）。
3. SSH 登录后执行 `id <你的用户名>`。群晖的第一个管理员用户通常是 `uid=1026`、`users` 组 `gid=100`，以实际输出为准。
4. 编辑 `docker-compose.yml`：`PUID` / `PGID` 填上一步的值，片库挂载写成 `/volume1/<共享文件夹>/...:/media/...:ro`。在同一目录建 `.env` 写令牌。
5. Container Manager → 项目 → 新增：路径选 `/volume1/docker/yingbox`，来源选「使用现有的 docker-compose.yml」，按向导构建并启动。界面构建失败时，SSH 进该目录执行 `sudo docker compose up -d --build`，之后项目会出现在 Container Manager 里。
6. 共享文件夹的权限里给这个用户至少「只读」；`/volume1/docker/yingbox/yingbox` 由入口脚本自动改属主，不用手动设。

DSM 自带反向代理：控制面板 → 登录门户 → 高级 → 反向代理，新增一条「HTTPS、你的域名、443 → HTTP、localhost、31480」；证书在控制面板 → 安全性 → 证书里申请 Let's Encrypt。注意下文「反向代理与 HTTPS」里 SSE 的要求，DSM 反代不方便调缓冲时，可以改用 Caddy 容器。

## 威联通（QTS / QuTS hero，Container Station 3）

1. App Center 装 **Container Station**；控制台 → 网络与文件服务 → Telnet / SSH 里打开 SSH。
2. 把仓库放到 `/share/Container/yingbox`（或任意共享文件夹）。
3. 威联通的 `admin` 是 uid 0，入口脚本会拒绝 `PUID=0`：新建一个普通用户，给媒体共享文件夹读权限，`id <用户名>` 查 uid / gid。
4. 编辑 `docker-compose.yml`：片库挂载写成 `/share/Multimedia/...:/media/...:ro`，配置和缓存可以改到 `/share/Container/yingbox/config`、`.../cache`。
5. SSH 进仓库目录执行 `docker compose up -d --build`（`docker` 命令由 Container Station 提供，装好后才有）。容器之后会出现在 Container Station 里。
   在 Container Station 的「应用程序 → 创建」里直接粘贴 YAML 也可以，但它不一定读取 `.env`，这时把 `YINGBOX_SERVER_TOKEN` 那一行的 `${...}` 整段换成令牌本身，并先在 SSH 里构建好镜像（`docker build -t yingbox-library:latest .`）。

反向代理：常用做法是再跑一个 Nginx Proxy Manager 或 Caddy 容器，见下文。

## Unraid

Unraid 不自带 compose。两种做法：装 **Compose Manager** 插件后照「通用步骤」做；或者在终端里构建后用 `docker run`：

```bash
cd /mnt/user/appdata/yingbox-src && docker build -t yingbox-library:latest .
docker run -d --name yingbox-library --restart unless-stopped \
  --security-opt no-new-privileges:true \
  -p 127.0.0.1:31480:31480 \
  -e PUID=99 -e PGID=100 -e TZ=Asia/Shanghai \
  -e YINGBOX_HOST=0.0.0.0 -e YINGBOX_SERVER_TOKEN='<至少 24 个字符的随机串>' \
  -v /mnt/user/appdata/yingbox/config:/config \
  -v /mnt/cache/appdata/yingbox/cache:/cache \
  -v /mnt/user/media/movies:/media/movies:ro \
  yingbox-library:latest
```

- Unraid 的惯例是 `nobody:users`，即 `99:100`；共享默认对这个身份可读。
- 缓存放在缓存池（`/mnt/cache/...`）上，避免缩略图频繁唤醒阵列硬盘。
- `/mnt/user` 是 shfs（FUSE）：默认的 `YINGBOX_WATCH=auto` 会只用定时扫描。想要秒级入库，可以把片库改成直接挂某块盘或缓存池的路径（`/mnt/disk1/...`、`/mnt/cache/...`），或者设 `YINGBOX_WATCH=events` 并确认新文件都是 Unraid 本机写入的。
- Docker 页面里显示的健康状态来自镜像自带的健康检查。

## 反向代理与 HTTPS

- **不要把 31480 直接映射到公网**。外网访问优先用 Tailscale / WireGuard 回家；确实要公网访问，走 HTTPS 反向代理，令牌就是唯一的门。
- 反代和服务在同一台机器上时，保持 compose 里的 `127.0.0.1:31480:31480`，反代连 `127.0.0.1:31480`（反代自己也在容器里时，把两者放进同一个 Docker 网络，反代连 `yingbox:31480`，并删掉 `ports`）。
- 要原样转发 `Host` 头（含非默认端口）：服务对改写类请求检查 `Origin` 与 `Host` 同源，Host 被改写或丢了端口，登录等请求会得到「跨站请求被拒绝」（403）。
- 关掉事件流的缓冲、放宽读超时：`/api/library/events` 是 SSE 长连接。
- 视频走 Range 请求，反代不要缓存或改写 `Range` / `Content-Range`。

Nginx（含 Nginx Proxy Manager 的「Advanced」自定义配置）：

```nginx
location / {
    proxy_pass http://127.0.0.1:31480;
    proxy_set_header Host $http_host;   # 原样转发 Host（含端口），同源检查要用
    proxy_http_version 1.1;
    proxy_buffering off;          # SSE 实时推送
    proxy_read_timeout 1h;        # SSE 长连接
    client_max_body_size 1m;
}
```

Caddy（默认就保留 Host、自动申请证书、对 SSE 立即转发）：

```caddy
yingbox.example.com {
    reverse_proxy 127.0.0.1:31480
}
```

## CloudDrive2 挂载的网盘

CloudDrive2（CD2）把 115、阿里云盘等挂成本地目录。CD2 自己在容器里跑时，挂载出现在它的 `/CloudNAS:shared` 对应的宿主目录下。

1. 映射 CD2 的**挂载根目录**（宿主上 `/CloudNAS:shared` 左边那个目录），传播用 `rslave`。CD2 重启或掉盘重挂后，新的挂载只有这样才能在片库容器里出现：
   ```yaml
   volumes:
     - type: bind
       source: /volume1/docker/CloudNAS # CD2 的 <path to accept cloud mounts>
       target: /media/cloud
       read_only: true
       bind:
         propagation: rslave
   ```
   网页端建库时选 `/media/cloud/115/...`。路径要在 `/media` 以内，否则网页端看不到。
2. **只读要在 CD2 里设**：`read_only` / `:ro` 只管挂载根，管不到容器启动之后才传播进来的子挂载（CD2 的每个网盘就是这种子挂载），而 Docker 的 `bind-recursive=readonly` 不能和 `rslave` 一起用。不想让片库服务写网盘，就在 CD2 的挂载设置里勾「只读」。
3. **权限**：CD2 Linux 挂载的「高级设置」可以指定 UID、GID 和权限（默认 `0755`，其他用户可读）。设成与 `PUID` / `PGID` 相同最省事；保持默认也能读，但写 NFO / 整理会失败。
4. **扫描频率**：网盘是 FUSE 文件系统，默认的 `YINGBOX_WATCH=auto` 只用定时扫描，每次扫描要对每个目录 `stat` 一次，对网盘就是一次次 API 请求。目录多时把 `YINGBOX_SCAN_INTERVAL` 调大（比如 `1800`），新文件靠手动扫描或等下一轮。
5. **悬停预览与播放**：网盘上的条目悬停时只显示已缓存的图片，不读视频；页内播放经服务转发 Range 请求，速度取决于 CD2 的缓存与网盘限速。

## 备份、迁移与排错

- 备份 `/config`（必须）和 `/cache`（建议）。停容器后复制目录即可；不停也行，但 `library.db` 用 WAL，要连同 `-wal`、`-shm` 一起复制。
- **从只有 `/data` 一个卷的老配置迁移**：把老目录挂到 `/config`，并在 `environment` 里设 `YINGBOX_CACHE_DIR: /config`，数据原样可用；想拆开，就停容器、把老目录里的 `media/` 和 `gfriends-index.json` 移到新的缓存目录，再按示例挂 `/cache`。
- 启动后立即退出、日志里是「对外监听（0.0.0.0）必须设置访问令牌」：`.env` 没被读到或令牌太短。`docker compose config | grep TOKEN` 看实际值。
- 日志里是「PUID / PGID 应为数字」或「不能是 0」：改 `PUID` / `PGID`。
- 网页端看得到文件夹、看不到文件，或扫描报权限错误：`PUID` / `PGID` 没有读权限。`docker compose exec yingbox setpriv --reuid=<PUID> --regid=<PGID> --clear-groups ls /media/<名字>` 可以按服务的身份试读。
- 健康检查一直 `unhealthy`：`docker inspect --format '{{json .State.Health}}' yingbox-library` 看每次检查的输出；改了 `YINGBOX_PORT` 时健康检查会跟着用新端口。
- 目录监控、inotify 上限、写入稳定判定等，见 [自动入库](../library-server.md#自动入库)。
