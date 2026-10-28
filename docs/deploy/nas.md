# 在 NAS 上用 Docker 部署片库服务

片库服务是影盒媒体库（电影、剧集）的独立 Node 版本，浏览器访问，能扫描、刮削、写 NFO、整理和在页内播放；在线板块（搜索、播放、下载）也在里面，见下文「在线播放」。
它能做什么、不能做什么，以及全部配置项，见 [片库服务](../library-server.md)；为什么这样部署，见 [ADR-0010](../adr/0010-docker-nas-deploy.md)。

镜像里只有 Node 服务和网页端，不含 Electron，amd64 / arm64 都能构建。目前没有发布好的镜像，需要在 NAS 上从源码构建。

## 先知道这几件事

- **默认只有 NAS 本机能访问**：compose 示例把端口映射到宿主的 `127.0.0.1:31480`，给同机的反向代理用。局域网直接访问要把 `ports` 改成 `'31480:31480'`。
- **默认不用登录**：没设 `YINGBOX_SERVER_TOKEN` 时服务不鉴权，打开网页就能用；对外监听（容器里的 `0.0.0.0`）时启动日志会警告「局域网内任何人都能访问」。需要登录时在 `.env` 里设置可选的访问令牌（至少 24 个字符、不是示例占位串，否则拒绝启动），网页端第一次打开会要求输入。
- **服务不以 root 运行**：容器以 root 启动入口脚本，把 `/config`、`/cache` 的属主改成 `PUID:PGID` 后降权。`PUID` / `PGID` 设成媒体文件的属主，或者至少是能读这些文件的用户。
- **片库只读挂载**：浏览、扫描、刮削、播放都只需要读。要写 NFO / 图片或整理改名，去掉对应挂载的 `:ro`。
- **镜像默认没有 ffmpeg / ffprobe**：多版本的 HDR / 杜比视界标退回看文件名，自动中文字幕不认内封字幕，按画面搜抽不了视频帧。构建参数 `WITH_CHROMIUM=1` 会一起装上（见「在线播放」），也可以设 `YINGBOX_FFPROBE` / `YINGBOX_FFMPEG` 指向挂进容器的程序。自动中文字幕默认关，设 `YINGBOX_AUTO_SUBTITLES: 'on'` 并给 `YINGBOX_OPENSUBTITLES_KEY`（见 [library-server.md](../library-server.md)）。

## 目录映射

| 容器内          | 放什么                                                                                                                                                                                                                            | 建议                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/config`       | `library.db`（片库数据库）、`secrets.json`（网页端填的 TMDB 令牌，0600）、`server-settings.json`（网页端改的服务端设置，含刮削语言 / 图片质量）；用了网盘时还有 `pan115-cookies.json`（0600）、`autograb*.json`、`scheduler.lock` | 必须持久化、必须备份；只让服务用户可读                                                 |
| `/cache`        | `media/`（海报原图、缩略图）等缓存                                                                                                                                                                                                | 可以放 SSD。缩略图删了会重建；海报原图删了要对条目「刷新元数据」才回来，所以也建议备份 |
| `/media/<名字>` | 片库目录，可以挂多个                                                                                                                                                                                                              | 默认 `:ro`。网页端只能在 `/media` 以内浏览和建库                                       |
| `/downloads`    | 在线板块的番号下载（`YINGBOX_DOWNLOAD_DIR`）                                                                                                                                                                                      | 要可写；入口只改这个目录本身的属主。可指向片库目录里的子文件夹，下完自动入库           |

`./yingbox/` 是 compose 示例的数据目录，已写进 `.gitignore` 与 `.dockerignore`，不会进 git 也不会进镜像。

## 通用步骤

需要 Docker 与 Compose v2（`docker compose version` 能输出版本）。

```bash
git clone https://github.com/Acefake/yingbox.git && cd yingbox
id <媒体文件属主的用户名>        # 记下 uid / gid，填到 docker-compose.yml 的 PUID / PGID
# 可选：需要登录时才写访问令牌 echo "YINGBOX_SERVER_TOKEN=$(openssl rand -hex 32)" > .env
# 编辑 docker-compose.yml：PUID / PGID、片库挂载（/volume1/video/... 换成你的目录）、需要时改端口
docker compose up -d --build
docker compose ps                  # STATUS 里出现 (healthy) 即启动完成，约 30 秒
```

浏览器打开 `http://127.0.0.1:31480/`（局域网直连时把地址换成 NAS 的 IP）直接用。设了访问令牌时打开 `/?token=<.env 里的令牌>`，或在页面上输入一次，之后靠 Cookie。

国内网络：

- 拉 `node` 基础镜像慢或失败时，给 Docker 配镜像加速。Dockerfile 用摘要固定了基础镜像，加速源返回的内容不一致会直接报错，不会悄悄换成别的镜像。
- 装依赖慢时，在 compose 的 `build.args` 里设 `NPM_REGISTRY: https://registry.npmmirror.com`（示例里有注释好的几行）。
- 访问 TMDB 等元数据站点要代理时，在 `environment` 里设 `HTTPS_PROXY` 等变量，并一起设 `NODE_USE_ENV_PROXY: '1'`，见 [代理](../library-server.md#代理)。

升级：`git pull && docker compose up -d --build`。`/config`、`/cache` 不受影响。

## 群晖（DSM 7.2，Container Manager）

1. 套件中心装 **Container Manager**；控制面板 → 终端机和 SNMP 里打开 SSH（只为查 uid、构建时用，用完可以关）。
2. 在 File Station 建 `/volume1/docker/yingbox`，把仓库放进去（SSH 里 `git clone`，或在电脑上下载 zip 后上传解压）。
3. SSH 登录后执行 `id <你的用户名>`。群晖的第一个管理员用户通常是 `uid=1026`、`users` 组 `gid=100`，以实际输出为准。
4. 编辑 `docker-compose.yml`：`PUID` / `PGID` 填上一步的值，片库挂载写成 `/volume1/<共享文件夹>/...:/media/...:ro`。需要登录时在同一目录建 `.env` 写访问令牌。
5. Container Manager → 项目 → 新增：路径选 `/volume1/docker/yingbox`，来源选「使用现有的 docker-compose.yml」，按向导构建并启动。界面构建失败时，SSH 进该目录执行 `sudo docker compose up -d --build`，之后项目会出现在 Container Manager 里。
6. 共享文件夹的权限里给这个用户至少「只读」；`/volume1/docker/yingbox/yingbox` 由入口脚本自动改属主，不用手动设。

DSM 自带反向代理：控制面板 → 登录门户 → 高级 → 反向代理，新增一条「HTTPS、你的域名、443 → HTTP、localhost、31480」；证书在控制面板 → 安全性 → 证书里申请 Let's Encrypt。注意下文「反向代理与 HTTPS」里 SSE 的要求，DSM 反代不方便调缓冲时，可以改用 Caddy 容器。

## 威联通（QTS / QuTS hero，Container Station 3）

1. App Center 装 **Container Station**；控制台 → 网络与文件服务 → Telnet / SSH 里打开 SSH。
2. 把仓库放到 `/share/Container/yingbox`（或任意共享文件夹）。
3. 威联通的 `admin` 是 uid 0，入口脚本会拒绝 `PUID=0`：新建一个普通用户，给媒体共享文件夹读权限，`id <用户名>` 查 uid / gid。
4. 编辑 `docker-compose.yml`：片库挂载写成 `/share/Multimedia/...:/media/...:ro`，配置和缓存可以改到 `/share/Container/yingbox/config`、`.../cache`。
5. SSH 进仓库目录执行 `docker compose up -d --build`（`docker` 命令由 Container Station 提供，装好后才有）。容器之后会出现在 Container Station 里。
   在 Container Station 的「应用程序 → 创建」里直接粘贴 YAML 也可以，但它不一定读取 `.env`：要用访问令牌时把 `YINGBOX_SERVER_TOKEN` 那一行的 `${...}` 整段换成令牌本身（不用就留着，等于不鉴权），并先在 SSH 里构建好镜像（`docker build -t yingbox-library:latest .`）。

反向代理：常用做法是再跑一个 Nginx Proxy Manager 或 Caddy 容器，见下文。

## Unraid

Unraid 不自带 compose。两种做法：装 **Compose Manager** 插件后照「通用步骤」做；或者在终端里构建后用 `docker run`：

```bash
cd /mnt/user/appdata/yingbox-src && docker build -t yingbox-library:latest .
docker run -d --name yingbox-library --restart unless-stopped \
  --security-opt no-new-privileges:true \
  -p 127.0.0.1:31480:31480 \
  -e PUID=99 -e PGID=100 -e TZ=Asia/Shanghai \
  -e YINGBOX_HOST=0.0.0.0 \
  -v /mnt/user/appdata/yingbox/config:/config \
  -v /mnt/cache/appdata/yingbox/cache:/cache \
  -v /mnt/user/media/movies:/media/movies:ro \
  yingbox-library:latest
```

- Unraid 的惯例是 `nobody:users`，即 `99:100`；共享默认对这个身份可读。
- 缓存放在缓存池（`/mnt/cache/...`）上，避免缩略图频繁唤醒阵列硬盘。
- `/mnt/user` 是 shfs（FUSE）：库的「存储」保持「自动」时会被判为网盘——不监听、不定时扫描、悬停预览不播视频，新文件只靠手动扫描（`YINGBOX_WATCH` 管不到网盘库）。片库放在 `/mnt/user` 上时，在网页端「媒体库设置 → 自动入库 → 存储」里改选「本地盘」，回到定时扫描（默认 5 分钟）；想要秒级入库，可以把片库改成直接挂某块盘或缓存池的路径（`/mnt/disk1/...`、`/mnt/cache/...`），或者改选「本地盘」后再设 `YINGBOX_WATCH=events` 并确认新文件都是 Unraid 本机写入的。
- Docker 页面里显示的健康状态来自镜像自带的健康检查。

## 在线播放

网页端的在线板块默认开启（ADR-0019，说明见 [在线播放](../library-server.md#在线播放)）：服务按需起一个在线引擎子进程，播放第三方地址时经服务的 `/api/stream` 代理。

- **不需要额外配置就能用**：CMS 源、豆瓣浏览、测速、播放。手机 / 电视浏览器里点播放，视频流经 NAS 转发。
- **被 Cloudflare 拦下的源**：镜像默认不带浏览器，这类源会在源列表里标成不可用。要用无头 Chromium 代抓：

  ```yaml
  services:
    yingbox:
      build:
        context: .
        args:
          WITH_CHROMIUM: '1' # 装 chromium、playwright-core、ffmpeg、中文字体，镜像约多 1 GB
      environment:
        YINGBOX_BROWSER: 'chromium:/usr/bin/chromium'
      shm_size: '256m' # Chromium 的共享内存；不设也能跑（已加 --disable-dev-shm-usage）
  ```

  `docker compose up -d --build` 后，日志里出现「浏览器代抓 Chromium（/usr/bin/chromium，经 playwright-core）」即生效。

- **局域网里的源**（自建 CMS、内网媒体服务器）：播放代理默认拒绝内网地址，设 `YINGBOX_STREAM_ALLOW_PRIVATE: '192.168.1.0/24'`（或主机名、IP，逗号分隔）。
- **下载**：映射 `/downloads`（compose 示例已有），`PUID` 要能写它。镜像默认没有 ffmpeg，下完保留 `.ts`；`WITH_CHROMIUM=1` 构建时会一起装上 ffmpeg，下完转 mp4。
- **不需要在线板块**：设 `YINGBOX_ONLINE: 'off'`，不起引擎、不开代理。
- **反向代理**：`/api/engine/events` 是 SSE、`/api/stream` 是长连接视频流，按下文「反向代理与 HTTPS」关掉缓冲（nginx `proxy_buffering off;`）、把读超时调到几分钟以上。

在 NAS 上验证：

1. 打开网页端「在线」页，豆瓣浏览出卡片；搜一部片，详情里选线路播放，能拖动进度。
2. `docker compose logs yingbox | grep 在线引擎` 能看到「在线引擎就绪」。
3. 局域网外的手机（或 iPhone Safari）播放 m3u8 源：开发者工具 / 抓包里清单和分片地址都是 `/api/stream?src=…`。
4. 不带 Cookie 访问 `/api/stream?src=…` 应返回 401；`src` 填 `http://127.0.0.1/` 应返回 403。

## 反向代理与 HTTPS

在 compose 的 `environment:` 中设置 `YINGBOX_PUBLIC_ORIGIN: https://media.example.com`，填浏览器实际访问的协议、域名与端口，不带路径。服务据此写入 `Secure` Cookie 并校验完整同源，不信任 `X-Forwarded-*` 头。启用后在 HTTPS 地址重新登录；后端端口仅供可信反向代理访问。本地 HTTP 部署不设置此项。

- **不要把 31480 直接映射到公网**。外网访问优先用 Tailscale / WireGuard 回家；确实要公网访问，走 HTTPS 反向代理，并务必设置访问令牌：它就是唯一的门。
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
4. **存储与扫描**：CD2 挂载是 FUSE，库的「存储」保持「自动」就按网盘处理：不监听、不定时扫描、启动不补扫，只在添加库时扫一次，之后新文件靠下面的变更通知或手动扫描入库（`YINGBOX_WATCH` / `YINGBOX_SCAN_INTERVAL` 只管本地盘库）。不想配通知、宁可轮询，就在「媒体库设置 → 自动入库 → 存储」里改选「本地盘」，回到定时扫描；每轮要对每个目录 `stat` 一次，对网盘就是一次次 API 请求，目录多时把 `YINGBOX_SCAN_INTERVAL` 调大（比如 `1800`）。
5. **变更通知**（CD2 的文件变更 webhook 是会员功能）：容器里没有桌面版那个 CD2 格式的通知地址（桌面版见 [网盘模式说明](../library-cloud-mode.md)），通知走片库服务自己的 API——`POST /api/library/rpc`，请求头 `Authorization: Bearer <YINGBOX_SERVER_TOKEN>`，请求体：

   ```json
   {
     "method": "notifyChanges",
     "params": {
       "changes": [
         { "action": "create", "path": "/115/电影/A (2001)/A.mkv" },
         {
           "action": "rename",
           "path": "/115/电影/旧.mkv",
           "destination": "/115/电影/新.mkv"
         }
       ]
     }
   }
   ```

   - `action` 只认 `create` / `modify` / `delete` / `rename`（小写）；一次最多 10 000 条。回包 `{ "ok": true, "result": { "accepted": 对应到库的条数, "ignored": 对不上的条数 } }`，令牌不对 401。
   - **路径映射**：通知里写 CD2 自己的路径（`/115/电影/...`）即可。库建在 `/media/cloud/115/电影` 时，按「库目录末尾几段 = 路径开头几段」自动对上；库目录就是挂载根（`/media/cloud`）、或两个库末尾同名时对不上，在 `params` 里加 `"mountRoot": "/media/cloud"`（CD2 的挂载根在**片库容器里**的路径，即上面 volumes 的 `target`）。对上后约 2 秒按目录增量扫描。
   - **地址**：CD2 与片库都用默认 bridge 网络时，把两者放进同一个 Docker 网络，地址写 `http://yingbox:31480/api/library/rpc`（compose 的服务名）；CD2 用 host 网络时写 `http://127.0.0.1:31480/api/library/rpc`（compose 默认就映射到宿主 `127.0.0.1:31480`）。CD2 跑在另一台机器上才需要局域网可达，按上文改 `ports`，令牌照旧必带。
   - CD2 的默认 webhook 请求体是 `{ "data": [{ "action", "source_file", "destination_file", ... }] }`，与上面的格式不同，需要在 CD2 的 webhook 配置（`webhook.toml`）里改请求体模板与请求头，或用一个小脚本转发；具体模板写法以 CD2 文档为准。只在 CD2 里发生的改动（挂载盘、它的网页、WebDAV、离线下载）才有通知，在网盘 App 里直接改的文件仍要手动扫描。

6. **悬停预览与播放**：网盘库悬停时只轮播已缓存的图片，不读视频，也不算指纹（识别时探测时长 / 算字幕哈希按需读，两次至少隔 1 秒）；页内播放经服务转发 Range 请求，速度取决于 CD2 的缓存与网盘限速。

## 115 网盘与追更

片库服务默认加载网盘与追更（`YINGBOX_NETDISK=on`），网页端的「网盘」页、设置 · 网盘、追剧日历里的追更区和「找 115 资源」都能用。原理与全部开关见 [网盘与追更](../library-server.md#网盘与追更)。

1. **登录 115**：网页端「设置 → 网盘」点扫码登录，用 115 App 扫。会话与 Cookie 存在 `/config`（0600），容器重启不用重扫；115 让会话失效时网页端会提示重新扫码。
2. **PanSou**：在同一页填 PanSou 地址（PanSou 也在 NAS 上跑时，填容器能访问到的地址，比如同一 Docker 网络里的 `http://pansou:8888`）。想在 compose 里固定，设 `YINGBOX_PANSOU_URL`。
3. **Torznab（Prowlarr / Jackett，可选）**：同一页「Torznab」里填接口地址和 API Key，点「测试连接」。地址按容器之间能互通的写：
   - 片库服务与 Prowlarr / Jackett 在**同一个 compose / Docker 网络**里：用服务名，比如 `http://prowlarr:9696/1/api`、
     `http://jackett:9117/api/v2.0/indexers/all/results/torznab/api`；
   - 不在同一网络（各自 bridge、或 Prowlarr 跑在 host 网络）：用 **NAS 的局域网 IP**，比如 `http://192.168.1.10:9696/1/api`。
     不要写 `localhost` / `127.0.0.1`——那是片库容器自己；
   - **Prowlarr**：每个索引器一个地址（索引器列表里点开，复制 Torznab Feed，形如 `http://NAS:9696/<索引器编号>/api`），一行一个，最多 8 个；API Key 在
     Settings → General → Security；
   - **Jackett**：聚合地址 `http://NAS:9117/api/v2.0/indexers/all/results/torznab/api` 一个就够；API Key 在 Jackett 首页右上角；
   - 想在 compose 里固定，设 `YINGBOX_TORZNAB_URL`（多个用逗号分隔）和 `YINGBOX_TORZNAB_API_KEY`；网页端保存过的优先。Key 存在 `/config/secrets.json`（0600）。
4. **磁力 115 离线下载**：网盘页磁力结果点「115 离线下载」，任务进 115 云下载，存到设置里的转存目标文件夹；「离线任务」分段看进度和失败原因。
   服务每 3 分钟查一次（只在持有调度租约的实例上，没有未完成任务时不查；打开「离线任务」时也会查），下载完成后按下面的挂载根通知片库入库。
   任务记录在 `/config/offline-tasks.json`。115 的云下载接口没在真实账号上验证过，第一次用时请看一眼 115 App 的云下载列表是否出现任务。
5. **转存后入库**：追更把文件转存进 115，片库要从 CD2 的挂载里看到它。按上一节把 CD2 挂载根映射进来（如 `/media/cloud`），并设
   ```yaml
   environment:
     YINGBOX_MOUNT_ROOT: /media/cloud # CD2 挂载根在片库容器里的路径
   ```
   转存（或离线下载完成）后服务直接通知片库按目录扫描（不需要 CD2 的 webhook）；路径对不上时文件要等手动扫描。也可以不设环境变量，在网页端改（设置键 `library.notify.mountRoot`）。
6. **只跑一份定时任务**：同一个 `/config` 只会有一个容器跑追更（`/config/scheduler.lock` 租约）。临时起第二个容器（比如测试新版本）时给它设 `YINGBOX_AUTOGRAB: 'off'`，或者干脆用另一份 `/config`。
7. **出网**：115、PanSou 与 Torznab 走 Node 自带的 fetch，需要代理时同样设 `HTTPS_PROXY` + `NODE_USE_ENV_PROXY: '1'`。
8. **不想要这些功能**：设 `YINGBOX_NETDISK: 'off'`，服务不加载网盘相关模块，也不向 115 发任何请求。

桌面版与片库服务各有一份追更状态，同一个 115 账号两边都开追更会各自转存同一集：开了这边就把桌面版的追更总开关关掉。

从桌面版迁移追更记录：把桌面版 userData 下的 `autograb.json`、`autograb-upgrade.json`、`autograb-movies.json` 拷进 `/config`（停容器时拷），115 需要在网页端重新扫码。

## 备份、迁移与排错

- 备份 `/config`（必须）和 `/cache`（建议）。停容器后复制目录即可；不停也行，但 `library.db` 用 WAL，要连同 `-wal`、`-shm` 一起复制。
- **从只有 `/data` 一个卷的老配置迁移**：把老目录挂到 `/config`，并在 `environment` 里设 `YINGBOX_CACHE_DIR: /config`，数据原样可用；想拆开，就停容器、把老目录里的 `media/` 及其它缓存文件移到新的缓存目录，再按示例挂 `/cache`。
- 启动后立即退出、日志里是「访问令牌只有 N 个字符」或「示例里的占位串」：设了访问令牌但太短 / 没改占位串，换成至少 24 个字符的随机串，或删掉它不鉴权。`docker compose config | grep TOKEN` 看实际值。
- 日志里是「PUID / PGID 应为数字」或「不能是 0」：改 `PUID` / `PGID`。
- 网页端看得到文件夹、看不到文件，或扫描报权限错误：`PUID` / `PGID` 没有读权限。`docker compose exec yingbox setpriv --reuid=<PUID> --regid=<PGID> --clear-groups ls /media/<名字>` 可以按服务的身份试读。
- 健康检查一直 `unhealthy`：`docker inspect --format '{{json .State.Health}}' yingbox-library` 看每次检查的输出；改了 `YINGBOX_PORT` 时健康检查会跟着用新端口。
- 目录监控、inotify 上限、写入稳定判定等，见 [自动入库](../library-server.md#自动入库)。
- 追更不动：日志里有「调度租约在别的实例手里」说明另一个容器（或刚被杀掉、90 秒内的旧进程）持有 `/config/scheduler.lock`；确认只有一个容器在用这份 `/config`。「网盘 / 追更：已关闭」说明设了 `YINGBOX_NETDISK=off`。

## 入库推送与直播

网页端设置 → 新入库支持 Bark / Telegram，配置保存在 `/config`；无需保持网页打开。密钥不回显，NAS 不提供桌面系统通知。

直播源与节目单由 NAS 读取，媒体经同源代理播放。局域网源在 `YINGBOX_STREAM_ALLOW_PRIVATE` 中显式放行主机或网段；网页用播放列表地址添加源，本地文件选择仅在桌面端提供。详见 [NAS 直播与入库推送](../library-server.md#nas-直播与入库推送)。
