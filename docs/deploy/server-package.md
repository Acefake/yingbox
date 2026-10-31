# 独立 Node.js 服务包

服务包由现有 `src/server` 构建，包含片库、网盘、追更、在线引擎和媒体接口。
与桌面端共用业务代码，在同一仓库维护；安装和运行不需要 Electron、Vue、Vite 或 TypeScript。
NAS 专用镜像仍按 [NAS 部署](nas.md) 使用，功能范围沿用 NAS 构建的配置。

## 构建

开发机安装 Node.js 22.13+ 与 pnpm，先按锁文件安装项目依赖：

```bash
pnpm install --frozen-lockfile
pnpm package:server
# 或：后端和网页一起打包
pnpm package:server:web
```

`out/packages/` 下得到可直接复制的目录与对应压缩包：

| 产物                                                   | 内容                         |
| ------------------------------------------------------ | ---------------------------- |
| `yingbox-server/`、`yingbox-server-<版本>.tgz`         | 后端与工作进程，只提供 API   |
| `yingbox-server-web/`、`yingbox-server-web-<版本>.tgz` | 相同后端与完整网页，同源访问 |

两种包都不携带 `node_modules`，需要在目标机器安装运行依赖。打包不会发布到 npm 或容器仓库。
构建从实际产物的外部模块生成专用 `package.json`，直接依赖使用构建时安装的精确版本；
延迟加载的 HTML 解析器与插件加密脚本也包含在清单中。传递依赖由目标机器安装时解析，首次安装后应保留生成的 `package-lock.json`，后续使用 `npm ci`。
`onnxruntime-node` 是可选依赖，可用 `--omit=optional` 跳过，届时按画面搜索不可用。

## 安装和启动

将压缩包传到目标机器，放在新的安装目录中解压：

```bash
mkdir yingbox-server
tar -xzf yingbox-server-web-<版本>.tgz -C yingbox-server --strip-components=1
cd yingbox-server
npm install --omit=dev
npm start -- --data-dir /你的配置目录 --media-root /你的媒体目录
```

只需要目标机器安装 Node.js 22.13 或更高版本。含网页包打开 `http://127.0.0.1:31480`；
仅后端包可通过 `http://127.0.0.1:31480/api/health` 检查运行状态。
支持重复指定 `--media-root`。配置目录存数据库、密钥与任务状态，应该与程序目录分开。

局域网访问使用 `--host 0.0.0.0`；通过环境变量 `YINGBOX_SERVER_TOKEN` 开启令牌鉴权，
对外监听时令牌至少 24 字符。未设令牌时，所有能访问地址的设备都能操作服务。
HTTPS 反向代理设置 `YINGBOX_PUBLIC_ORIGIN=https://你的域名`。

可从任意工作目录运行：

```bash
node /安装路径/out/server/server.js --data-dir /配置目录 --media-root /媒体目录
```

含网页包按自身位置自动发现 `dist-web/`，不依赖当前工作目录；可用 `--web-dir off` 关闭网页。
仅后端包可用 `--web-dir /网页目录` 托管另行构建的网页，两者需保持版本一致。
没有额外配置跨域访问；推荐用后端托管网页，或由反向代理统一网页、`/api` 和 `/media` 的来源。

FFmpeg、ffprobe 和可选 Chromium 不在包内，按实际需要安装；完整环境变量见 [片库服务](../library-server.md)。
浏览器解码限制仍然适用，本包不增加实时转码。

## 验证和更新

开发机可以验证已解压、安装依赖的包，测试使用临时片库和离线夹具，不读取实际账号：

```bash
node scripts/smoke-server.mjs --package /独立安装目录
```

覆盖服务启动、鉴权、目录浏览、在线引擎子进程、扫描识别、事件推送、海报缩略图和视频 Range。
含网页包也会验证从临时工作目录启动时的网页自动发现。真实在线来源与 115 账号仍需在实际网络中验收。

升级时停止服务，备份配置目录，在新的程序目录解压、安装依赖，再指向原配置目录启动。
服务接收 SIGTERM / SIGINT 后关闭工作进程并保存状态；恢复旧程序版本前应恢复与之匹配的数据备份。
