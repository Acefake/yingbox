# 影盒 yingbox

影盒是一款本地影视管理与在线观看应用，提供 Electron 桌面端和可部署在 NAS 上的片库服务。

[下载发行版](https://github.com/Acefake/yingbox/releases) · [报告问题](https://github.com/Acefake/yingbox/issues) · [NAS 部署](docs/deploy/nas.md) · [第三方授权](THIRD_PARTY_NOTICES.md)

## 功能

- **本地媒体库**：扫描电影和剧集，识别片名、季集与多版本文件，从 TMDB 刮削元数据，写入 Kodi 标准 NFO、海报和剧照，按模板整理文件。
- **片库浏览**：海报墙、演员资料、观看进度、卡片悬停预览和视频墙；按画面搜索可在本机下载模型并建立索引。
- **网盘与挂载盘**：本地库、网盘库分别管理，支持 CloudDrive2 变更通知和增量扫描，详见 [网盘模式](docs/library-cloud-mode.md)。
- **在线观看**：聚合 CMS 和 CatSpider 插件源，支持来源管理、搜索、播放与 HLS 下载。豆瓣首页和详情无需 TMDB Token，TMDB 可作为补充信息源。
- **播放器**：支持本地文件、HLS、多音轨和外挂字幕。桌面内置播放器使用独立窗口，网页端使用页面播放层；桌面端还可选择 mpv，启用高质量缩放，Windows 的受支持设备可使用 RTX 视频超分。
- **网页与 NAS**：片库核心可作为独立 Node 服务运行，通过浏览器访问，也支持 Docker 部署。

## 安装与首次使用

桌面安装包见 [GitHub Releases](https://github.com/Acefake/yingbox/releases)，以各版本实际发布的系统和架构为准。源码包含 Windows、macOS 和 Linux 的打包配置。

启动后可按需要配置：

1. 在媒体库中添加电影或剧集目录。
2. 需要 TMDB 刮削时，在设置中填写自己的 TMDB API Read Access Token。豆瓣浏览不需要填写。
3. 需要在线播放时，在数据源管理中选择或配置来源。
4. 在播放器设置中选择内置播放器或 mpv，在下载设置中选择保存目录。

Windows 构建可附带便携版 mpv；缺失时可在应用中按需安装。macOS 和 Linux 可使用系统安装的 mpv。视频探测、转封装及部分画面处理功能需要 ffmpeg、ffprobe，具体配置见 [片库服务文档](docs/library-server.md)。

## 从源码运行

需要 Git、Node.js 22 或更高版本，以及 pnpm 10 或更高版本。

```bash
git clone https://github.com/Acefake/yingbox.git
cd yingbox
pnpm install
pnpm dev
```

`pnpm dev` 启动 Electron 应用，后台引擎按需启动。桌面端无需单独运行 HTTP 服务。

日常使用在应用设置中填写令牌。开发时也可参照 [.env.example](.env.example) 创建本地 `.env`，设置可选的 `YINGBOX_TMDB_TOKEN` 或 `VITE_TMDB_ACCESS_TOKEN`。不要把真实令牌、Cookie、账号数据或本地配置提交到仓库。

### 网页端与片库服务

在两个终端中分别运行：

```bash
pnpm dev:server
```

```bash
pnpm dev:web
```

片库服务默认监听 `127.0.0.1:31480`，网页开发服务代理其 API 和媒体请求。生产构建：

```bash
pnpm build:server
pnpm build:web
pnpm start:server
```

NAS 安装、目录挂载、网络访问和 Docker 配置见 [部署指南](docs/deploy/nas.md)。服务端未配置 `YINGBOX_SERVER_TOKEN` 时不启用登录鉴权；允许其他设备访问前，应按部署文档设置访问令牌。

独立 Node 服务包可用 `pnpm package:server` 构建，仅包含后端；`pnpm package:server:web` 同时携带网页。
产物位于 `out/packages/`，解压后安装运行依赖即可启动，无需 Electron 或源码仓库，见 [独立服务包](docs/deploy/server-package.md)。

## 开发检查

| 命令                 | 用途                                |
| -------------------- | ----------------------------------- |
| `pnpm typecheck`     | 主进程、界面和测试的类型检查        |
| `pnpm lint`          | ESLint 与文件大小检查               |
| `pnpm test`          | 全量 Vitest 测试                    |
| `pnpm test:affected` | 运行相对 `origin/main` 受影响的测试 |
| `pnpm check:style`   | 界面组件与设计令牌检查              |
| `pnpm check:case`    | 导入路径大小写检查                  |
| `pnpm check:copy`    | 界面文案与注释检查                  |
| `pnpm smoke:server`  | 片库服务离线冒烟检查                |

## 构建桌面安装包

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

macOS 安装包在 macOS 上构建。构建产物位于 `dist/`。Windows 构建会准备固定版本的 mpv；各平台打包时自动收集第三方授权文件。

发布前核对 [第三方组件发行记录](docs/release-licenses.md)，确认所分发二进制的授权、对应源码与构建材料齐全。

## 项目结构

```text
src/
  main/        Electron 主进程、窗口、IPC、系统能力与片库引擎
  engine/      在线来源、豆瓣与下载引擎
  preload/     沙箱预加载与桌面 API 桥接
  renderer/    Vue 界面，按功能组织
  server/      独立片库服务、HTTP API 与媒体流
  shared/      共享契约、类型和工具
scripts/       开发、打包、授权收集与工程检查
tests/         自动化测试
docs/          部署指南、架构说明与 ADR
licenses/      第三方许可证与版权声明
```

技术栈：Electron 37、Vue 3、TypeScript、Tailwind CSS 4、SQLite、Vitest 和 pnpm。桌面端通过 IPC 连接界面与后台引擎，片库服务复用媒体库核心。

## 参与贡献

通过 [Issues](https://github.com/Acefake/yingbox/issues) 报告问题或讨论需求。问题报告请附系统版本、应用版本、复现步骤和已脱敏的日志；涉及媒体文件时说明格式与编码信息。

提交 Pull Request 前阅读 [项目约定](AGENTS.md)，保持改动范围集中，说明改动目的和验证结果。新增代码、资源或依赖时，注明来源及适用许可证，并保留原作者要求的版权声明。

## 许可证与第三方授权

影盒自有代码采用 [MIT 许可证](LICENSE)，允许使用、修改、商用及再分发，分发时需保留版权声明和许可全文。软件按原样提供，不附带担保。

第三方代码、依赖、模型和资源保留各自的授权，详见 [第三方软件声明](THIRD_PARTY_NOTICES.md) 和 [许可证目录](licenses/)。根目录的 MIT 许可证不替代这些条款。主许可证和第三方声明均随桌面发行包提供。

Windows 发行包附带固定版本 mpv 的许可、完整对应源码、补丁和构建记录，位于安装目录的 `resources/third-party/mpv/`；详见 [发行记录与源码构建步骤](docs/release-licenses.md)。

TMDB、豆瓣及用户配置的数据源、媒体和图片另受其服务条款与权利人授权约束。项目的软件许可证不授予第三方媒体内容的版权。
