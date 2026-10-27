# ADR-0010 NAS / Docker 部署：容器化独立片库服务，默认只听本机

- 状态：已采纳（2026-10-22）
- 相关：PR #72；部署说明 docs/deploy/nas.md

## 背景

想在 NAS 上常驻片库（扫描、刮削、网页端浏览与播放）。仓库里已有不依赖 Electron 的片库服务（`src/server`，`node out/server/server.js`，`tests/server/no-electron.test.ts` 守着依赖图）和一份单阶段风格的 Dockerfile，但它有几处不适合直接放到 NAS 上：

- 镜像里写死 `YINGBOX_HOST=0.0.0.0`，令牌没设时自动生成并打印到日志，NAS 面板与日志收集里谁都能看到；
- 基础镜像只写 `node:22-bookworm-slim`，运行镜像里带着 pnpm、装依赖用的清单；
- 只能用 compose 的 `user:` 指定身份，`/data` 一个卷里混着数据库、密钥和图片缓存；片库默认可写挂载。

## 决策

- **容器化现有 Node 服务**，不跑 Electron：片库核心与宿主分离早已完成，网页端是同一套界面；在线 / 下载本来就不在片库服务里。
- **多阶段构建**：`base`（固定版本的 pnpm）→ `deps` → `build`（`build:server` + `build:web`）与 `prod-deps`（`--prod`）→ `runtime`（只有 node_modules、`out/server`、`dist-web`、入口与健康检查脚本）。基础镜像写死完整版本号 + 多架构索引摘要，各阶段同一个。`NPM_REGISTRY` 构建参数给国内换源。
- **服务进程不以 root 运行，身份可配**：容器以 root 进 `docker/entrypoint.sh`，只把 `/config`、`/cache` 里属主不对的条目改成 `PUID:PGID`（`chown -h`，不跟随链接，属主对的不动），再 `setpriv --reuid --regid --clear-groups` exec 服务；`PUID` / `PGID` 非数字或为 0 拒绝启动。用 `user:` 启动时原样执行。
- **默认只听 127.0.0.1**（服务默认值，镜像不改）。对外监听（`--host` / `YINGBOX_HOST` 不是回环地址）时，服务启动前检查 `YINGBOX_SERVER_TOKEN`：必须显式设置、至少 24 个字符、不是示例占位串，否则退出码 1（`src/server/exposure.ts`）。compose 示例设 `YINGBOX_HOST=0.0.0.0`（容器里不这样端口映射进不来），令牌用 `${YINGBOX_SERVER_TOKEN:?}` 从 `.env` 必填，端口只映射到宿主 `127.0.0.1`，局域网直连要手改。
- **三类卷**：`/config`（`library.db`、`secrets.json`，必须备份）、`/cache`（`media/` 海报原图与缩略图等缓存；新增 `--cache-dir` / `YINGBOX_CACHE_DIR`，默认等于数据目录，直接跑 Node 的本机部署布局不变）、片库挂在 `/media/...` 下并默认 `:ro`。
- **健康检查**：`docker/healthcheck.mjs` 按 `YINGBOX_HOST` / `YINGBOX_PORT` 请求公开的 `/api/health`，200 且 `ok: true` 才算健康。

## 后果

- 镜像 360 MB → 338 MB（arm64 实测），运行镜像里没有 pnpm；升级 Node 要同时改两处 `FROM` 的版本号与摘要。
- 原来用 `--host 0.0.0.0` 跑、靠自动生成令牌的本机部署，升级后要显式设 `YINGBOX_SERVER_TOKEN` 才能启动。
- 原来挂 `/data` 的容器要改挂法：旧目录挂到 `/config`，并把 `YINGBOX_CACHE_DIR` 设为 `/config`（或把旧目录里的 `media/` 及其它缓存文件移到新的缓存卷），见 docs/deploy/nas.md。
- `:ro` 管不到容器启动后才传播进来的子挂载（CloudDrive2 掉盘重挂、`rslave`），`bind-recursive=readonly` 又要求 `rprivate`，与 `rslave` 不能同用：网盘的只读要在 CloudDrive2 挂载选项里勾「只读」。
- 片库只读时写 NFO / 图片、整理改名会失败（按需去掉 `:ro`）；对外访问要用户自己配 HTTPS 反向代理。

## 否决方案

- 用 Electron 在 xvfb 下无头运行：镜像多出 Chromium 与 GTK 依赖（数百 MB），换来的在线 / 下载功能片库服务本就不提供，而片库部分已有纯 Node 实现。
- 镜像里 `USER node` 写死：NAS 上媒体文件属主各不相同，只能靠 `user:`，又没法替用户整理已有卷的属主。
- 引入 gosu / su-exec：Debian 自带 `setpriv`（util-linux）就够了，不多装包。
- 对外监听时接受自动生成的令牌：令牌会出现在日志里；要求用户自己设置，也让「对外」成为一次明确的选择。
- 片库默认可写：多数人只浏览和刮削，可写留给明确需要写 NFO / 整理的人。

## 修订（2026-10-27）：访问令牌改成可选

- **决策**：没设 `YINGBOX_SERVER_TOKEN` 时服务不鉴权，所有接口、媒体与事件流直接可用；不再自动生成、落盘或打印令牌，数据目录里早期生成的 `server.token` 启动时删掉。对外监听且没设令牌时照常启动，启动日志警告局域网内任何人可访问。设了令牌时行为与上文一致（`?token=` / Cookie 登录），对外监听时仍要求至少 24 个字符、不是占位串，否则拒绝启动。compose 示例的令牌写成 `${YINGBOX_SERVER_TOKEN:-}`，留空不鉴权。
- **原因**：家用 NAS 多在可信局域网里，强制令牌让第一次部署多一步、网页端和桌面端进度同步都要先粘贴令牌，用户反馈体验很差；令牌留给真正需要的场景（反向代理到公网、共享网络）。
- **后果**：默认部署下局域网内任何人都能读写片库（含扫描、改元数据、播放代理）；公网访问必须自己设令牌。桌面端进度同步的令牌同样可选，只在服务回 401 时才显示输入。
