# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/macOS) for media library management:

- **本地媒体库** — scans movie/TV folders, scrapes TMDB / JavBus metadata, writes Kodi-standard NFO + images
- **在线播放** — aggregates CMS sites (`cms-sites.json`) and CatSpider plugin sites, resolves play URLs via the Go backend
- **内置播放器** — dedicated player window: local files streamed over `local://` (HTTP Range), HLS/m3u8, auto-mounted sidecar subtitles (srt/ass → WebVTT)

Stack: Electron 37 shell + Vue 3 SPA + Go 1.22 HTTP backend (127.0.0.1:31471) with Python scripts embedded into the Go binary.

## Common commands

```bash
pnpm dev            # Electron + Go backend concurrently
pnpm dev:backend    # Go backend only (go build + run)
pnpm typecheck      # tsc (main/preload) + vue-tsc (renderer)
pnpm lint           # eslint --cache
pnpm test           # vitest run (tests/)
pnpm format         # prettier --write .
pnpm build          # typecheck + electron-vite build
pnpm build:nocheck  # electron-vite build only
pnpm build:backend  # go build -o main.exe (packages/services/backend)
pnpm build:win      # Windows zip (builds Go backend first)
pnpm build:win:full # Windows NSIS installer
pnpm build:mac      # macOS dmg
pnpm check          # scripts/check-issues.sh
pnpm check:case     # import case-sensitivity check (Windows-safe against mac/Linux breakage)
pnpm start          # electron-vite preview (production-like)
```

## Architecture

The app runs as a **frameless Electron window** (1200×900 minimum). IPC is the only boundary: the main process owns all OS access (filesystem, dialogs, shell, HTTP, child processes); the renderer is a Vue 3 SPA with five routes.

### Three-process layout (electron-vite)

```
src/main/    → Electron main process (out/main/index.js)
src/preload/ → Preload script (context bridge → window.api)
src/renderer/→ Vue 3 SPA (out/renderer/)
```

### Main process (`src/main/`)

- `index.ts` — bootstrap only: window creation (frameless, `sandbox: true`), CSP hardening, `local://` protocol registration, DevTools shortcuts, wiring the modules below
- `config.ts` — `userData/config.json` (`downloadPath`); validates writability (real write probe) on load and on set
- `backend-manager.ts` — spawns the Go backend in packaged builds (dev uses `pnpm dev:backend`); kills it on quit
- `ipc/` — per-domain IPC registrations, called from `index.ts`:
  - `file-ipc.ts` (`file:*` incl. incremental `scanMediaDirectory`, `path:*`; `readImage` capped at 16MB)
  - `http-ipc.ts` (`http:fetch/fetchImage/download`; image proxy capped at 8MB)
  - `dialog-ipc.ts` (`dialog:*`, `config:setDownloadPath`, `shell:openPath`)
  - `app-ipc.ts` (`win:*`, `app:*`, `update:*` + electron-updater status events)
  - `subtitle-ipc.ts` (`subtitle:find/read`; only accepts `local://` URLs)
- `file-operations.ts` — atomic write / atomic replace / move with per-path locks
- `http-client.ts` — SSRF-guarded fetch (private-IP blocking incl. DNS resolution, manual redirect hops), size-limited reads, atomic downloads
- `local-media.ts` — `local://` URL ↔ filesystem path + HTTP Range streaming (206/416)
- `media-scanner.ts` — incremental library scan (directory-mtime short-circuit + cache reuse)
- `player-window.ts` — singleton player window; normalizes payloads, caps playlists at 500 items
- `subtitle.ts` — sidecar subtitle discovery, encoding detection (UTF-8/UTF-16/GB18030), srt/ass → WebVTT

### Preload (`src/preload/index.ts`)

Exposes `window.api` only, namespaced: `file.* http.* path.* dialog.* config.* app.* update.* shell.* win.* player.* subtitle.*`. Types: `src/preload/index.d.ts`.

**Sandboxed preload:** only `electron` may be imported — no npm packages (a sandboxed preload cannot `require` them).

### Renderer (`src/renderer/src/`)

Routes (`router/routers.ts`): `/` online, `/movie`, `/tv`, `/av`, `/player-popout`; catch-all → `/`.

- `api/` — `tmdb.ts` (token from settings or `VITE_TMDB_ACCESS_TOKEN`, no hardcoded default), `backend.ts` (Go backend client, Bearer key, image/proxy URL helpers)
- `services/nfo-service.ts` — Kodi NFO parse/generate
- `stores/scrape-provider-store.ts` — provider config in localStorage (`scrapeProviderConfig`)
- `composables/` — cross-view: `use-vod-parser`, `use-media-player`, `use-global-queue`, `use-error-handler`, `use-context-menu`
- `views/Movie|TV/` — file tree + scraping, each with its own `composables/`
- `views/online/` — CMS/CatSpider search + `DetailWindow.vue`; `views/av/` — MissAV library
- `components/UnifiedVideoPlayer.vue` — Artplayer + hls.js wrapper (subtitles, playback-rate memory)

### Go backend (`packages/services/backend/main.go`)

HTTP server on **127.0.0.1:31471**. Embeds Python via `//go:embed py/…` and extracts it next to the binary at startup (never overwrites existing `cfg/` / `db/`).

- Endpoints: `/api/videos`, `/api/videos/<id>`, `/api/meta/<avid>`, `/api/scrape/<avid>`, `/api/addvideo/<avid>`, `/api/queue`, `/api/vod/parse`, `/api/vod/sites`, `/file/<id>/<name>`, `/proxy?url=…`
- Security env vars: `BIND_ADDR` (default loopback), `YINGBOX_API_KEY` (Bearer / `?key=`), `YINGBOX_ALLOWED_ORIGINS`, `YINGBOX_PROXY_URL`, `YINGBOX_ALLOW_PRIVATE_PROXY` (`/proxy` denies private targets by default), `YINGBOX_ALLOW_INSECURE_LAN`
- Library path resolution: `YINGBOX_CONFIG_PATH` (config.json `downloadPath`) → `MISSAV_VIDEO_PATH` → `~/Videos` → temp dir

### App settings

- localStorage: `scrapeProviderConfig` (provider, TMDB token, backend URL/key), `imageDownloadSize_*`, `folderContent_*` (tree cache), `metadataLanguage`, `player_playback_rate`
- `userData/config.json` (main process): `downloadPath`
- Build-time env: `VITE_TMDB_ACCESS_TOKEN` — optional default TMDB token; never commit a real one (see `.env.example`)

### Tests

`pnpm test` — Vitest (node env), `tests/` covers main-process pure logic: Range parsing, `local://` path mapping, subtitle decoding/conversion, SSRF IP classification, incremental scan reuse. Vue components are not unit-tested.

### Build pipeline

`electron-vite build` → `out/`; `electron-builder` → `dist/` (win nsis/portable/zip, mac dmg, linux AppImage/snap/deb). The Go binary and `backend/py` ship via `extraResources`.

Build outputs (`out/`, `packages/services/backend/main*`) are gitignored and untracked — regenerate with `pnpm build:backend` / `pnpm build`.

### Tech stack

| Layer          | Technology                                    |
| -------------- | --------------------------------------------- |
| Desktop shell  | Electron 37 (sandboxed preload, frameless)    |
| Build tooling  | electron-vite 5, Vite 7                       |
| Renderer       | Vue 3.5, TypeScript 5.9, Pinia 3, vue-router 4|
| UI kit         | Ant Design Vue 4.x, Tailwind CSS 4            |
| Player         | Artplayer 5, hls.js                           |
| Metadata       | @tdanks2000/tmdb-wrapper, cheerio             |
| Go backend     | Go 1.22, modernc.org/sqlite (no CGo needed)   |
| Tests          | Vitest 5                                      |
| Python scripts | Embedded in the Go binary via //go:embed      |
