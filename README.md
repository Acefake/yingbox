# 影盒 yingbox

影视资源管理与在线观看的桌面应用（Windows / macOS）。

- **本地媒体库**：扫描电影、剧集目录，从 TMDB 刮削元数据，写入 Kodi 标准 NFO 与图片
- **在线播放**：聚合 CMS 站点（`cms-sites.json`）与 CatSpider 插件站点
- **内置播放器**：本地文件（`local://`，支持 Range）、HLS/m3u8、外挂字幕，可选 mpv
- **番号库**：独立的「番号」页（成人模式下出现在侧栏「本地媒体」里），TS 实现的 25 个番号站点刮削 + 演员资料、目录监控自动入库与整理（取代原 Amane 侧车），见 [docs/library-server.md](docs/library-server.md)
- **片库服务（网页端 / NAS）**：同一套媒体库核心以独立 Node 服务运行，浏览器访问，可用 Docker 部署到 NAS，见 [docs/library-server.md](docs/library-server.md)

## 技术栈

Electron 37 · Vue 3 + TypeScript · 自带 UI 组件库 + Tailwind CSS 4 · 引擎（Electron utilityProcess：在线源 / MissAV / 下载）· pnpm

## 目录

```
src/
  main/        Electron 主进程：窗口、IPC、配置、引擎宿主、mpv/lada 管理
  engine/      引擎（utilityProcess）：在线源解析、MissAV、HLS 下载
  preload/     沙箱预加载，暴露 window.api
  renderer/    Vue 3 单页应用
  server/      独立片库服务（Node）：HTTP RPC / SSE / 媒体流 / 鉴权，托管网页端
  shared/      主进程与渲染进程共用的类型和工具
scripts/       开发、打包、检查脚本
tests/         vitest 单元测试
docs/          设计文档
build/         打包资源（图标、NSIS、entitlements）
```

## 开发

```bash
pnpm install
pnpm dev            # Electron（引擎随应用按需启动，无需单独起后端）
pnpm typecheck      # tsc + vue-tsc
pnpm lint
pnpm test
pnpm build:win      # Windows zip
pnpm build:mac
```

片库服务（网页端）：

```bash
pnpm dev:server     # 片库服务（127.0.0.1:31480）
pnpm dev:web        # 网页端，/api 与 /media 代理到片库服务
pnpm build:server && pnpm build:web && pnpm start:server
pnpm smoke:server   # 离线冒烟
```

部署（本机 / NAS Docker）、配置、代理与 curl-impersonate 见 [docs/library-server.md](docs/library-server.md)。

需要 Node 22+、pnpm 10。更多架构说明见 [AGENTS.md](AGENTS.md)。

## 许可

`src/engine/download/sources.ts` 的站点解析逻辑移植自 [NASSAV](https://github.com/Satoing/NASSAV)（MIT，见 `src/engine/download/LICENSE-NASSAV`）。
