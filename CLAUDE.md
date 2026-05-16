# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/Mac) for media resource management, online streaming, and metadata scraping. It has a Vue 3 + TypeScript frontend, an Electron main-process shell, and a Go backend for MissAV content serving.

## Common commands

```bash
# Dev (Electron + Go backend concurrently)
pnpm dev

# Type checking
pnpm typecheck          # both node (tsc) and web (vue-tsc) targets
pnpm typecheck:node     # tsc for main/preload
pnpm typecheck:web      # vue-tsc for renderer

# Lint / format
pnpm lint               # eslint --cache
pnpm format             # prettier --write .

# Build
pnpm build              # typecheck + electron-vite build
pnpm build:nocheck      # skip typecheck
pnpm build:win          # full Windows installer
pnpm build:mac          # full macOS installer

# Go backend only
pnpm dev:backend        # cd packages/services/backend && go run .

# Start preview (no hot-reload, production-like)
pnpm start

# Check for issues after refactoring
pnpm check              # run all checks (typecheck, lint, etc.)
pnpm check:fix          # run checks and auto-fix lint issues
```

## Architecture

The app runs as a **frameless Electron window** (1200×900 minimum). IPC is the boundary: the main process owns all OS access (filesystem, dialogs, shell, HTTP requests, child processes). The renderer is a single-page Vue 3 app with six routes.

### Three-process layout (electron-vite)

```
src/main/index.ts    → Electron main process (out/main/index.js)
src/preload/index.ts → Preload script (context bridge → window.api / window.electron)
src/renderer/        → Vue 3 SPA (out/renderer/)
```

Renderer path aliases (defined in `electron.vite.config.ts`):
- `@renderer` → `src/renderer/src`
- `@` → `src/renderer/src`

Dev server proxies `/api` to `https://api.themoviedb.org/3` (for TMDB API calls during development).

**Main process** ([src/main/index.ts](src/main/index.ts)) handles:

- Window management (`win:minimize`, `win:maximize`, `win:close`, `win:isMaximized`)
- File operations (`file:read`, `file:write`, `file:delete`, `file:exists`, `file:mkdir`, `file:readdir`, `file:stat`, `file:readImage`, `file:copy`, `file:move`)
- Path utilities (`path:join`, `path:resolve`, `path:dirname`, `path:basename`, `path:extname`)
- Native dialogs (`dialog:openDirectory`, `dialog:selectDirectory`, `dialog:openFile`, `dialog:saveFile`)
- HTTP fetch proxy (`http:fetch` for JSON, `http:fetchImage` for images (bypasses hotlink), `http:download` for file downloads)
- `local://` protocol handler for streaming local video files to the built-in player
- Auto-updater (`update:check`, `update:download`, `update:install`)
- Video player window (`player:open` — supports both local files and online URLs)
- Detail popup window (`detail:open` singleton, `detail:getData`)
- Config management (`config:setDownloadPath` — persisted in `userData/config.json`)
- DevTools shortcuts: F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)
- Go backend lifecycle: spawns `packages/services/backend/main.exe` on startup, kills on quit

**Preload** ([src/preload/index.ts](src/preload/index.ts)) exposes `window.api` with namespaced methods: `file.*`, `http.*`, `path.*`, `dialog.*`, `app.*`, `shell.*`, `player.*`, `win.*`, `detail.*`.

### Renderer: Vue 3 SPA

Routes (defined in [src/renderer/src/router/routers.ts](src/renderer/src/router/routers.ts)):

- `/` → Online search & streaming ([views/online/index.vue](src/renderer/src/views/online/index.vue))
- `/movie` → Movie file management & scraping ([views/Movie/index.vue](src/renderer/src/views/Movie/index.vue))
- `/tv` → TV show file management & scraping ([views/TV/index.vue](src/renderer/src/views/TV/index.vue))
- `/av` → Adult video resources online playback ([views/av/index.vue](src/renderer/src/views/av/index.vue))
- `/vod-test` → VOD parser test window ([views/VODTestWindow.vue](src/renderer/src/views/VODTestWindow.vue))
- `/online-detail` → Detail popup window singleton ([views/online/DetailWindow.vue](src/renderer/src/views/online/DetailWindow.vue))

Key directories under `src/renderer/src/`:

- `api/` — API clients: TMDB wrapper (`@tdanks2000/tmdb-wrapper`), Go backend (localhost:31471), MetaTube
- `services/` — Business logic: `FileService`, `NfoService`, `ScrapeService`
- `stores/` — Pinia stores: `file-store` (file tree + cache), `scrape-queue-store` (batch scraping queue), `selection-store`, `ui-store`, `scrape-provider-store` (provider config + tokens persisted in localStorage)
- `views/Movie/` and `views/TV/` each have their own `composables/` for view-specific logic (use-file-management, use-scraping, use-media-processing, use-scraping-task, etc.)
- `components/` — Shared UI: `AppLayout`, `WinControls` (custom titlebar), `SettingsPanel`, `QueueWidget`, `ImageSettingsModal`, `MediaSearchModal`, etc.
- `directives/` — Custom Vue directives: context-menu, right-click, scroll-x

### Go backend ([packages/services/backend/main.go](packages/services/backend/main.go))

A self-contained HTTP server on port **31471** that:

- Scans `F:/新建文件夹` for MissAV video directories (IDs as folder names)
- API routes:
  - `/api/videos` — cached list sorted by mtime
  - `/api/videos/<id>` — detail with NFO parsing + fanart discovery
  - `/api/meta/<avid>` — JavBus metadata via Python
  - `/api/addvideo/<avid>` — download trigger via Python
  - `/api/scrape/<avid>` — scraping via Python
  - `/api/queue` — download queue management
  - `/api/vod/parse` — VOD parser
- Serves local image/video files via `/file/<videoID>/<filename>` and proxies external images via `/proxy?url=...`
- Manages a download queue (text file + SQLite dedup check)
- Calls Python scripts located at `packages/services/backend/py/`

### Python scripts

Python scraping/downloading has been migrated to the Go backend. The Go backend (`packages/services/backend/`) now calls Python scripts internally (`fetch_meta.py`, `scrape.py`, `main.py`) located at `packages/services/backend/py/`. These are bundled as `extraResources` via `electron-builder.yml`.

### App settings

User settings are stored in `localStorage` (renderer side). Key keys:

- `scrapeProviderConfig` — provider type, TMDB token, Go backend URL, MetaTube config
- `imageDownloadSize_poster` / `imageDownloadSize_backdrop` / `imageDownloadSize_actor`
- `folderContent_fileData` / `folderContent_currentPath` — file tree cache
- `metadataLanguage`, `videoPlayer`

### Build pipeline

`electron-vite build` → `out/` (main, preload, renderer bundles)
`electron-builder` → `dist/` (Windows NSIS, macOS DMG, Linux AppImage/snap/deb)

### Tech stack summary

| Layer          | Technology                                         |
| -------------- | -------------------------------------------------- |
| Desktop shell  | Electron 37                                        |
| Build tooling  | electron-vite 5, Vite 7                            |
| Renderer       | Vue 3.5, TypeScript 5.9, Pinia 3                   |
| UI kit         | Ant Design Vue 4.x, Tailwind CSS 4                 |
| Metadata       | @tdanks2000/tmdb-wrapper, cheerio (scraping)       |
| Go backend     | Go 1.22, modernc.org/sqlite (no CGo needed)        |
| Python scripts | Called as child processes for scraping/downloading |
