# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/macOS) for media library management:

- **本地媒体库** — scans movie/TV folders, scrapes TMDB metadata, writes Kodi-standard NFO + images
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
pnpm build:backend  # go build -o main.exe (packages/backend)
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

Exposes `window.api` only, namespaced: `amane.* file.* http.* path.* dialog.* config.* app.* update.* shell.* win.* player.* subtitle.*`. Types: `src/preload/index.d.ts`.

**Sandboxed preload:** only `electron` may be imported — no npm packages (a sandboxed preload cannot `require` them).

### Renderer (`src/renderer/src/`)

Routes (`router/routers.ts`): `/` online, `/movie`, `/tv`, `/amane`, `/av`, `/player-popout`; catch-all → `/`.

- `api/` — `tmdb.ts` (token from settings or `VITE_TMDB_ACCESS_TOKEN`, no hardcoded default), `backend.ts` (Go backend client, Bearer key, image/proxy URL helpers)
- `services/nfo-service.ts` — Kodi NFO parse/generate
- `stores/scrape-provider-store.ts` — provider config in localStorage (`scrapeProviderConfig`)
- `composables/` — cross-view: `use-vod-parser`, `use-media-player`, `use-global-queue`, `use-error-handler`, `use-context-menu`
- `views/Movie|TV/` — file tree + scraping, each with its own `composables/`
- `views/online/` — CMS/CatSpider search + `DetailWindow.vue`; `views/av/` — MissAV library
- `components/UnifiedVideoPlayer.vue` — Artplayer + hls.js wrapper (subtitles, playback-rate memory)

### Go backend (`packages/backend/main.go`)

HTTP server on **127.0.0.1:31471**. Embeds Python via `//go:embed py/…` and extracts it next to the binary at startup (never overwrites existing `cfg/` / `db/`).

- Endpoints: `/api/videos`, `/api/videos/<id>`, `/api/addvideo/<avid>`, `/api/queue`, `/api/vod/parse`, `/api/vod/sites`, `/file/<id>/<name>`, `/proxy?url=…`
- Security env vars: `BIND_ADDR` (default loopback), `YINGBOX_API_KEY` (Bearer / `?key=`), `YINGBOX_ALLOWED_ORIGINS`, `YINGBOX_PROXY_URL`, `YINGBOX_ALLOW_PRIVATE_PROXY` (`/proxy` denies private targets by default), `YINGBOX_ALLOW_INSECURE_LAN`
- Library path resolution: `YINGBOX_CONFIG_PATH` (config.json `downloadPath`) → `MISSAV_VIDEO_PATH` → `~/Videos` → temp dir

### Amane

`src/main/amane-manager.ts` supervises the pinned Amane 0.20.1 backend via bounded IPC; `src/renderer/src/views/Amane` provides the Vue section with horizontal navigation and advanced search. Upstream is the `packages/amane/upstream` submodule; in development the manager runs that Python source directly (edits apply on backend restart), while packaged builds use the pinned `Amane.Server`. Playback resolves indexed media IDs through the existing player; no community playback plugin is required. Build-time runtime preparation and GPL source delivery: `packages/amane/README.md`. Legacy AV metadata scraping endpoints and Python scrapers are removed; online browsing and downloading remain.

### App settings

- localStorage: `scrapeProviderConfig` (provider, TMDB token, backend URL/key), `imageDownloadSize_*`, `folderContent_*` (tree cache), `metadataLanguage`, `player_playback_rate`
- `userData/config.json` (main process): `downloadPath`
- Build-time env: `VITE_TMDB_ACCESS_TOKEN` — optional default TMDB token; never commit a real one (see `.env.example`)

### Tests

`pnpm test` — Vitest (node env), `tests/` covers main-process pure logic: Range parsing, `local://` path mapping, subtitle decoding/conversion, SSRF IP classification, incremental scan reuse. Vue components are not unit-tested.

### Build pipeline

`electron-vite build` → `out/`; `electron-builder` → `dist/` (win nsis/portable/zip, mac dmg, linux AppImage/snap/deb). The Go binary and `backend/py` ship via `extraResources`.

Build outputs (`out/`, `packages/backend/main*`) are gitignored and untracked — regenerate with `pnpm build:backend` / `pnpm build`.

### Tech stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Desktop shell  | Electron 37 (sandboxed preload, frameless)     |
| Build tooling  | electron-vite 5, Vite 7                        |
| Renderer       | Vue 3.5, TypeScript 5.9, Pinia 3, vue-router 4 |
| UI kit         | Ant Design Vue 4.x, Tailwind CSS 4             |
| Player         | Artplayer 5, hls.js                            |
| Metadata       | @tdanks2000/tmdb-wrapper, cheerio              |
| Go backend     | Go 1.22, modernc.org/sqlite (no CGo needed)    |
| Tests          | Vitest 5                                       |
| Python scripts | Embedded in the Go binary via //go:embed       |

## UI conventions

- Look: Apple-like restraint, generous whitespace; neutral grays, color comes from posters. Accent blue only for focus, links and toggles; selected states use `--bg-active`.
- Tokens live in `src/renderer/src/assets/styles/tokens.css`. Never hard-code font sizes or radii; `pnpm check:style` enforces it (`node scripts/style-tokens.mjs --fix` migrates).
- Shared controls live in `src/renderer/src/components/ui/`: `UiButton`, `UiIconButton` (icon + required `label`, shown as tooltip), `UiSegmented` (tabs), `UiNavItem` (sidebar / settings / tab-bar navigation; `collapsed` hides the label and shows it as tooltip, `layout="stack"` for the phone bottom bar, `current="page" | "pressed" | "none"`), `UiListRow` (clickable multi-line row; `role` / `aria-*` pass through, e.g. `menuitemradio`), `UiChip` (small gray pill for actors/tags; put a separate `UiIconButton` next to it for remove), `UiPressable` (unstyled button for image/card targets; pass `label` when the content has no text), `UiPosterCard` + `.ui-poster-grid`, `UiIcon`, `v-tooltip`.
- No raw `<button>` in `.vue` files outside `components/ui/` — pick one of the components above (`UiPressable` when nothing else fits). `pnpm check:style` fails on violations.
- Form controls: `UiInput` (`size` sm/md, `variant` default/filled, `icon` / `#leading`, `clearable` + `@clear`, `invalid`), `UiTextarea` (`autosize`), `UiSelect` (`options` or `<option>` slot), `UiSwitch`, `UiCheckbox`, `UiRadio`. They accept `v-model` or `:value`/`:checked` + native events; `UiInput`/`UiSelect` put `class` on the wrapper and every other attr/listener on the native element, and expose `focus()`. No raw `<input>` / `<select>` / `<textarea>` outside `components/ui/` except `type="file|range|hidden"` — `pnpm check:style` enforces it.
- No static `style="..."` in templates (use a class + tokens; dynamic `:style` is fine) and no emoji as status icons (use `UiIcon` or plain text) — `pnpm check:style` enforces the inline-style rule.
- Ant `message` / `notification` / `Modal.confirm` take their theme from `utils/theme.ts` (read from tokens.css) and their look from `assets/styles/antd-overrides.css`; use `confirmDialog` from `utils/confirm-dialog.ts` for confirmations.
- New `components/ui` styles wrap state/modifier selectors in `:where()`, so a single page class overrides sizing and colors.
- Prefer `UiIconButton` over text buttons; keep at most one `UiButton variant="primary"` per area (e.g. Play).
