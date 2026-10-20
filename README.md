# 影盒 yingbox

影视资源管理与在线观看的桌面应用（Windows / macOS）。

- **本地媒体库**：扫描电影、剧集目录，从 TMDB 刮削元数据，写入 Kodi 标准 NFO 与图片
- **在线播放**：聚合 CMS 站点（`cms-sites.json`）与 CatSpider 插件站点
- **内置播放器**：本地文件（`local://`，支持 Range）、HLS/m3u8、外挂字幕，可选 mpv
- **Amane 片库**：独立板块，由主进程托管 Amane 服务（子模块，固定 0.20.1）

## 技术栈

Electron 37 · Vue 3 + TypeScript · Ant Design Vue 4 + Tailwind CSS 4 · Go 1.22 后端（127.0.0.1:31471，内嵌 Python 脚本）· pnpm

## 目录

```
src/
  main/        Electron 主进程：窗口、IPC、配置、后端/Amane/mpv/lada 管理
  preload/     沙箱预加载，暴露 window.api
  renderer/    Vue 3 单页应用
  shared/      主进程与渲染进程共用的类型和工具
packages/
  backend/     Go HTTP 后端（py/ 为内嵌的 Python/Node 脚本）
  amane/       Amane 上游源码子模块
scripts/       开发、打包、检查脚本
tests/         vitest 单元测试（主进程纯逻辑）与 Python 测试
docs/          设计文档
build/         打包资源（图标、NSIS、entitlements）
```

## 开发

```bash
pnpm install
pnpm dev            # Electron + Go 后端
pnpm typecheck      # tsc + vue-tsc
pnpm lint
pnpm test
pnpm build:win      # Windows zip（先构建 Go 后端）
pnpm build:mac
```

需要 Node 22+、pnpm 10、Go 1.22+。更多架构说明见 [AGENTS.md](AGENTS.md)。

## 许可

`packages/backend` 的下载器脚本源自 [NASSAV](https://github.com/Satoing/NASSAV)（MIT，见 `packages/backend/LICENSE-NASSAV`）。
