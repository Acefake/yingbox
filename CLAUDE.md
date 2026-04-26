# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

poster-scraper is an Electron desktop app (Windows/Mac) for scraping movie and TV show poster metadata. It has a Vue 3 + TypeScript frontend, an Electron main-process shell, and a Go backend for MissAV content serving.

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
```

## Architecture

The app runs as a **frameless Electron window** (1200×900 minimum). IPC is the boundary: the main process owns all OS access (filesystem, dialogs, shell, HTTP requests, child processes). The renderer is a single-page Vue 3 app with four routes.

### Three-process layout (electron-vite)

```
src/main/index.ts    → Electron main process (out/main/index.js)
src/preload/index.ts → Preload script (context bridge → window.api / window.electron)
src/renderer/        → Vue 3 SPA (out/renderer/)
```

**Main process** ([src/main/index.ts](src/main/index.ts)) handles:
- Window management (frameless, min/max/close via IPC)
- File operations (read/write/delete/mkdir/readdir/stat/copy/move/readImage/readdirRecursive)
- Path utilities (join/dirname/basename/extname)
- Native dialogs (openDirectory, openFile, saveFile)
- HTTP fetch proxy (JSON requests, image fetching to bypass hotlink protection, file downloads)
- `local://` protocol handler for streaming local video files to the built-in player
- Python child process management (`scraper:scrape`, `scraper:fetchMeta`, downloader spawn/cancel)
- Go backend lifecycle (spawns `bd/backend/main.exe` on startup, kills on quit)
- A dedicated `detail:open` IPC for a singleton popup window (detail view)

**Preload** ([src/preload/index.ts](src/preload/index.ts)) exposes `window.api` with namespaced methods: `file.*`, `http.*`, `path.*`, `dialog.*`, `app.*`, `shell.*`, `player.*`, `win.*`, `detail.*`, `scraper.*`, `downloader.*`.

### Renderer: Vue 3 SPA

Routes (defined in [src/renderer/src/router/routers.ts](src/renderer/src/router/routers.ts)):
- `/` → Online search & streaming ([views/online/Index.vue](src/renderer/src/views/online/Index.vue))
- `/movie` → Movie file management & scraping ([views/movie/Index.vue](src/renderer/src/views/movie/Index.vue))
- `/tv` → TV show file management & scraping ([views/tv/Index.vue](src/renderer/src/views/tv/Index.vue))
- `/online-detail` → Detail popup window singleton

Key directories under `src/renderer/src/`:
- `api/` — API clients: TMDB wrapper (`@tdanks2000/tmdb-wrapper`), Go backend (localhost:31471), MetaTube
- `services/` — Business logic: `FileService`, `NfoService`, `ScrapeService`
- `stores/` — Pinia stores: `file-store` (file tree + cache), `scrape-queue-store` (batch scraping queue), `selection-store`, `ui-store`, `scrape-provider-store` (provider config + tokens persisted in localStorage)
- `views/movie/` and `views/tv/` each have their own `composables/` for view-specific logic (use-file-management, use-scraping, use-scrape-processor, etc.)
- `components/` — Shared UI: `AppLayout`, `WinControls` (custom titlebar), `SettingsPanel`, `QueueWidget`, `ImageSettingsModal`, `MediaSearchModal`, etc.
- `directives/` — Custom Vue directives: context-menu, right-click, scroll-x

### Go backend ([packages/services/backend/main.go](packages/services/backend/main.go))

A self-contained HTTP server on port **31471** that:
- Scans `F:/新建文件夹` for MissAV video directories (IDs as folder names)
- Serves `/api/videos` (cached list sorted by mtime), `/api/videos/<id>` (detail with NFO parsing + fanart discovery), `/api/meta/<avid>` (JavBus metadata via Python), `/api/addvideo/<avid>` (download trigger via Python)
- Serves local image/video files via `/file/<videoID>/<filename>` and proxies external images via `/proxy?url=...`
- Manages a download queue (text file + SQLite dedup check)
- Calls Python scripts (`fetch_meta.py`, `scrape.py`, `main.py`) located at `packages/services/tools/`

### Python scripts

The main process can spawn Python scripts from three contexts:
- `scraper:scrape` → `python tools/scrape.py <avid>` (full scrape: images + NFO, returns JSON)
- `scraper:fetchMeta` → `python tools/fetch_meta.py <avid>` (metadata only, returns JSON)
- `downloader:start` → `python main.py <avid>` (full download, streams log output via IPC)

These scripts run from a `bd/` directory (bundled with the built app, not in source).

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

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 37 |
| Build tooling | electron-vite 4, Vite 7 |
| Renderer | Vue 3.5, TypeScript 5.9, Pinia 3 |
| UI kit | Ant Design Vue 4.x, Tailwind CSS 4 |
| Metadata | @tdanks2000/tmdb-wrapper, cheerio (scraping) |
| Go backend | Go 1.22, modernc.org/sqlite (no CGo needed) |
| Python scripts | Called as child processes for scraping/downloading |
