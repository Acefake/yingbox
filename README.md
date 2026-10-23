# 影盒 yingbox

本地影视管理与在线观看的桌面应用（Windows / macOS），片库也能以独立服务跑在 NAS 上、用浏览器访问。

## 功能

- **本地媒体库**：扫描电影、剧集目录，识别片名与季集，从 TMDB 刮削元数据，写入 Kodi 标准 NFO 与图片，可按模板整理文件；海报墙按人脸取景，卡片悬停预览，视频墙多格同时播放
- **网盘 / 挂载盘**：每个库可设为本地盘或网盘；网盘库不监控、不定时扫描，可接 CloudDrive2 变更通知按目录增量扫描，见 [docs/library-cloud-mode.md](docs/library-cloud-mode.md)
- **在线观看**：聚合苹果 CMS 资源站（内置 `cms-sites.json` + 订阅远程清单 + 自定义源）与 CatSpider 插件站点，可检测可用性；豆瓣片单浏览与筛选，详情页剧照（TMDB，豆瓣兜底）
- **内置播放器**：本地文件（`local://`，支持 Range）、HLS/m3u8、外挂字幕；应用内播放弹窗，可缩成角落小窗，可选 mpv
- **下载**：HLS（含 AES-128）与直链下载，断点续传，下载目录可在设置里改
- **片库服务（网页端 / NAS）**：同一套媒体库核心以独立 Node 服务运行，浏览器访问，可用 Docker 部署，见 [docs/library-server.md](docs/library-server.md)、[docs/deploy/nas.md](docs/deploy/nas.md)

## 技术栈

Electron 37 · Vue 3 + TypeScript · 自带 UI 组件库 + Tailwind CSS 4 · 两个 utilityProcess（在线源 / 下载引擎、片库引擎，`node:sqlite`）· Vitest · pnpm

## 目录

```
src/
  main/        Electron 主进程：窗口、IPC、设置、引擎宿主、片库引擎、缩略图、mpv 插件宿主
  engine/      引擎（utilityProcess）：在线源解析、豆瓣、下载
  preload/     沙箱预加载，暴露 window.api
  renderer/    Vue 3 界面，按功能放在 src/features/ 下
  server/      独立片库服务（Node）：HTTP RPC / SSE / 媒体流 / 鉴权，托管网页端
  shared/      主进程、引擎、界面共用的类型、契约和工具
scripts/       开发、打包、检查脚本
tests/         Vitest 测试
docs/          设计文档、部署指南、ADR（docs/adr/）
docker/        容器入口与健康检查
build/         打包资源（图标、NSIS、entitlements）
```

## 开发

需要 Node 22+、pnpm 10。

```bash
pnpm install
pnpm dev            # 桌面应用（引擎按需启动，无需单独起后端）
```

片库服务（网页端）：

```bash
pnpm dev:server     # 片库服务（127.0.0.1:31480）
pnpm dev:web        # 网页端，/api 与 /media 代理到片库服务
pnpm build:server && pnpm build:web && pnpm start:server
pnpm smoke:server   # 离线冒烟
```

## 检查

```bash
pnpm typecheck      # tsc + vue-tsc（主进程、界面、测试）
pnpm lint           # ESLint（warning 也算失败）+ 单文件行数
pnpm test           # 全部测试；开发中可用 pnpm test:affected 只跑受影响的
pnpm check:style    # 设计令牌与视觉纪律
pnpm check:case     # import 大小写
pnpm check:copy     # 文案只写最终状态
```

## 打包

检查和安装包构建在本地运行；发布时手动将构建产物上传到 GitHub Releases。

```bash
pnpm build:win        # Windows zip
pnpm build:win:full   # Windows 安装包
pnpm build:mac        # 只能在 macOS 上运行
pnpm build:linux
```

架构与约定见 [AGENTS.md](AGENTS.md)。
