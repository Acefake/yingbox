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
pnpm build:win          # full Windows installer (zip)
pnpm build:win:full     # full Windows installer (NSIS)
pnpm build:mac          # full macOS installer

# Go backend only
pnpm dev:backend        # cd packages/services/backend && go run .
pnpm build:backend      # cd packages/services/backend && go build -o main.exe .

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

Path aliases (defined in `electron.vite.config.ts` and `tsconfig.*.json`):

- `@renderer` / `@` → `src/renderer/src`
- `@main` → `src/main`
- `@preload` → `src/preload`
- `@shared` → `src/shared`

Dev server runs on `127.0.0.1:3000` and proxies `/api` to `https://api.themoviedb.org/3` (for TMDB API calls during development).

**Main process** ([src/main/index.ts](src/main/index.ts)) is organized into modules under [src/main/modules/](src/main/modules/):

- `window-manager.ts` — Creates frameless BrowserWindow (1200×900 min, 85% of screen)
- `ipc-handlers.ts` — All IPC channel registrations:
  - `win:*` (minimize, maximize, close, isMaximized)
  - `file:*` (read, write, delete, exists, mkdir, readdir, readdirRecursive, stat, copy, move, readImage)
  - `path:*` (join, resolve, dirname, basename, extname)
  - `dialog:*` (openDirectory, selectDirectory, openFile, saveFile)
  - `http:*` (fetch for JSON, fetchImage to bypass hotlink, download)
  - `config:*`, `app:*`, `update:*`, `shell:*`
  - `detail:*` (singleton popup window)
  - `player:*` (opens video player window using resources/player.html)
- `backend-manager.ts` — Spawns Go backend executable (`main.exe`) on startup in production, kills on quit. In dev, assumes backend started separately via `pnpm dev:backend`
- `auto-updater.ts` — Configures electron-updater (auto-download disabled), sends status via `update:status` IPC
- `config.ts` — Reads/writes `userData/config.json` (currently stores `downloadPath`)
- `local://` protocol handler for streaming local video files to the built-in player
- DevTools shortcuts: F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)

**Preload** ([src/preload/index.ts](src/preload/index.ts)) exposes `window.api` with namespaced methods: `file.*`, `http.*`, `path.*`, `dialog.*`, `app.*`, `shell.*`, `player.*`, `win.*`, `detail.*`. Also defines `window.api.scraper` and `window.api.downloader` as empty objects (extensibility points). Type definitions are in [src/renderer/src/env.d.ts](src/renderer/src/env.d.ts).

A separate preload exists at `resources/player-preload.js` for the video player window.

### Renderer: Vue 3 SPA

Routes (defined in [src/renderer/src/router/routers.ts](src/renderer/src/router/routers.ts)):

- `/` → Online search & streaming ([views/online/Index.vue](src/renderer/src/views/online/Index.vue))
- `/movie` → Movie file management & scraping ([views/Movie/index.vue](src/renderer/src/views/Movie/index.vue))
- `/tv` → TV show file management & scraping ([views/TV/index.vue](src/renderer/src/views/TV/index.vue))
- `/av` → Adult video resources online playback ([views/av/Index.vue](src/renderer/src/views/av/Index.vue))
- `/vod-test` → VOD parser test window ([views/VODTestWindow.vue](src/renderer/src/views/VODTestWindow.vue))
- `/online-detail` → Detail popup window singleton ([views/online/DetailWindow.vue](src/renderer/src/views/online/DetailWindow.vue))

`App.vue` wraps all non-detail routes in `AppLayout` with `<keep-alive>`. `DetailWindow` renders standalone (no layout shell).

Key directories under `src/renderer/src/`:

- `api/` — API clients: TMDB wrapper (`tmdb.ts`), Go backend at localhost:31471 (`backend.ts`), MetaTube server (`metatube.ts`)
- `stores/` — Pinia stores: `scrape-provider-store` (provider config + tokens persisted in localStorage as `scrapeProviderConfig`)
- `composables/` — Global composables:
  - `use-global-queue.ts` — Module-level singleton task queue with concurrent processing (max 3), dedup, progress tracking, cancellation
  - `use-vod-parser.ts` — VOD parser client (parse, search, getCards, getTracks, getPlayinfo) via Go backend
  - `use-error-handler.ts` — `safeExecute` / `safeExecuteSync` wrappers with Ant Design message toasts
  - `use-context-menu.ts` — MenuItem interface definition
- `views/Movie/composables/` — Movie-specific: `use-file-management`, `use-scraping`, `use-media-processing`, `use-scraping-task`
- `views/TV/composables/` — TV-specific: `use-tv-file-management`, `use-tv-scraping`
- `components/` — Shared UI: `AppLayout` (frosted-glass navbar + blurred background), `WinControls` (custom titlebar), `SettingsPanel`, `SourceManagerPanel`, `QueueWidget`, `MediaSearchModal`
- `types/` — TypeScript interfaces: `ProcessedItem`, `FileItem`, `ActorInfo`, `MovieInfoType`, `EpisodeInfo`, `SeasonInfo`, `TVShowInfoType`
- `directives/` — Custom Vue directives: `v-context-menu`, `v-scroll-x`

### Go backend ([packages/services/backend/main.go](packages/services/backend/main.go))

A self-contained HTTP server on port **31471** that:

- Scans for MissAV video directories (path from `MISSAV_VIDEO_PATH` env var, defaults to `F:/新建文件夹`)
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
- Embeds Python scripts via `//go:embed` from `packages/services/backend/py/`

### App settings

User settings are stored in `localStorage` (renderer side). Key keys:

- `scrapeProviderConfig` — provider type, TMDB token, Go backend URL, MetaTube config
- `imageDownloadSize_poster` / `imageDownloadSize_backdrop` / `imageDownloadSize_actor`
- `folderContent_fileData` / `folderContent_currentPath` — file tree cache
- `metadataLanguage`, `videoPlayer`

Config in `userData/config.json` (main process): `downloadPath`.

### Build pipeline

`electron-vite build` → `out/` (main, preload, renderer bundles)
`electron-builder` → `dist/` (Windows NSIS/zip, macOS DMG, Linux AppImage/snap/deb)

### Code style

- **Prettier:** single quotes, no semicolons, trailing commas (es5), 2-space indent, LF line endings
- **ESLint:** TypeScript + Vue recommended rules, `prefer-template` enforced, import sorting (`sort-imports`), padding-line-between-statements (blank lines required around functions, consts, types, and after imports)
- **TypeScript:** `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny` are enabled
- Vue SFC `<script>` blocks must use `lang="ts"`

### Tech stack summary

| Layer          | Technology                                         |
| -------------- | -------------------------------------------------- |
| Desktop shell  | Electron 37                                        |
| Build tooling  | electron-vite 5, Vite 7                            |
| Renderer       | Vue 3.5, TypeScript 5.9, Pinia 3                   |
| UI kit         | Ant Design Vue 4.x, Tailwind CSS 4                 |
| Metadata       | @tdanks2000/tmdb-wrapper, cheerio (scraping)       |
| Go backend     | Go 1.22, modernc.org/sqlite (no CGo needed)        |
| Python scripts | Embedded in Go binary via //go:embed               |
| Package manager| pnpm                                               |
