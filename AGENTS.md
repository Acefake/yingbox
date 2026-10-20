# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/macOS) for media library management:

- **本地媒体库** — scans movie/TV folders, scrapes TMDB metadata, writes Kodi-standard NFO + images
- **在线播放** — aggregates CMS sites (`cms-sites.json`) and CatSpider plugin sites, resolves play URLs in the engine (`src/engine/online`)
- **内置播放器** — dedicated player window: local files streamed over `local://` (HTTP Range), HLS/m3u8, auto-mounted sidecar subtitles (srt/ass → WebVTT)

Stack: Electron 37 shell + Vue 3 SPA + an engine `utilityProcess` (`src/engine/`: online sources, MissAV, HLS downloads) reached through the IPC contract. There is no HTTP backend and no Go/Python runtime.

## Common commands

```bash
pnpm dev            # Electron (engine starts on demand)
pnpm typecheck      # tsc (main/preload) + vue-tsc (renderer)
pnpm lint           # eslint --cache
pnpm test           # vitest run (tests/)
pnpm format         # prettier --write .
pnpm build          # typecheck + electron-vite build
pnpm build:nocheck  # electron-vite build only
pnpm build:win      # Windows zip
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
- `engine/` — hosts the engine `utilityProcess` (on demand, MessagePort RPC); `browser-fetch.ts` renders Cloudflare-protected pages in a hidden Chromium window for the engine; `media-headers.ts` injects Referer for direct stream/cover requests
- `plugins/` — plugin host for Amane / lada / mpv: `host.ts` (register stop/health, prefixed logs, quit cleanup that waits for every running plugin) and `process.ts` (kill process tree, wait for exit, line log relay, one-shot `runTool`). All three start on demand; do not add `app.on('before-quit')` elsewhere in `src/main` (a test enforces it)
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

- `features/<x>/` — one folder per non-library feature (`views/ components/ composables/ api/ utils/` inside): `online` (CMS/CatSpider search, `DetailWindow`, data-source panel), `av` (MissAV), `download`, `amane`, `lada`, `player` (`UnifiedVideoPlayer`, mpv/popout, play progress), `settings` (panel + section registry), `shell` (`AppLayout`). Features import each other only through `features/<x>/index.ts` (eslint `yingbox/feature-boundaries`, `scripts/eslint/feature-boundaries.mjs`); the composition layer (`main.ts`, `App.vue`, `router/`) may point at view files directly so routes stay lazy. Feature-owned settings sections are registered in `main.ts` with an `order`.
- `api/tmdb.ts` (token from settings or `VITE_TMDB_ACCESS_TOKEN`). Renderer code must not call `fetch` directly (eslint; only `features/amane/api/amane.ts` is exempt)
- `services/nfo-service.ts` — Kodi NFO parse/generate
- `stores/scrape-provider-store.ts` — provider config in localStorage (`scrapeProviderConfig`)
- `views/Movie|TV/` — library (file tree + scraping, owned by the library project); `components/UnifiedVideoPlayer.vue`, `composables/use-media-player.ts`, `composables/use-lada-tasks.ts` are one-line re-exports kept for it (delete after the library merge)
- shared: `components/ui/` (design system), `components/` (page chrome, `StatusState`), `composables/` (`use-global-queue`, `use-error-handler`, `use-context-menu`, `use-platform`), `utils/`

### Engine (`src/engine/`)

Runs in an Electron `utilityProcess`, started on first use by `src/main/engine`. Domains: `online` (CMS sites, CatSpider plugins, VOD parse), `av` (MissAV catalogue + resolver), `download` (site → m3u8 lookup, HLS download with AES-128, JSON atomic queue in `userData/downloads/queue.json`, optional ffmpeg remux). All outbound HTTP goes through `src/shared/net` (SSRF guard). Replaces the former Go backend on 127.0.0.1:31471, removed in p3d.

### Amane

`src/main/amane-manager.ts` supervises the pinned Amane 0.20.1 backend via bounded IPC; `src/renderer/src/features/amane` provides the Vue section with horizontal navigation and advanced search. Upstream is the `packages/amane/upstream` submodule; in development the manager runs that Python source directly (edits apply on backend restart), while packaged builds use the pinned `Amane.Server`. Playback resolves indexed media IDs through the existing player; no community playback plugin is required. Build-time runtime preparation and GPL source delivery: `packages/amane/README.md`. Legacy AV metadata scraping endpoints and Python scrapers are removed; online browsing and downloading remain.

### App settings

- localStorage: `scrapeProviderConfig` (provider, TMDB token; legacy backend URL/key kept only for the library mirror), `imageDownloadSize_*`, `folderContent_*` (tree cache), `metadataLanguage`, `player_playback_rate`
- `userData/config.json` (main process): `downloadPath`
- Build-time env: `VITE_TMDB_ACCESS_TOKEN` — optional default TMDB token; never commit a real one (see `.env.example`)

### Tests

`pnpm test` — Vitest (node env), `tests/` covers main-process pure logic: Range parsing, `local://` path mapping, subtitle decoding/conversion, SSRF IP classification, incremental scan reuse. Vue components are not unit-tested.

### Build pipeline

`electron-vite build` → `out/`; `electron-builder` → `dist/` (win nsis/portable/zip, mac dmg, linux AppImage/snap/deb). `extraResources` ships Amane and mpv only.

Build outputs (`out/`) are gitignored and untracked — regenerate with `pnpm build`.

### Tech stack

| Layer             | Technology                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| Desktop shell     | Electron 37 (sandboxed preload, frameless)                                             |
| Build tooling     | electron-vite 5, Vite 7                                                                |
| Renderer          | Vue 3.5, TypeScript 5.9, vue-router 4                                                  |
| UI kit            | Ant Design Vue 4.x, Tailwind CSS 4                                                     |
| Player            | Artplayer 5, hls.js                                                                    |
| Metadata          | @tdanks2000/tmdb-wrapper                                                               |
| CatSpider runtime | cheerio, crypto-js (required by `backend/py/catspider_runner.js`, not by the renderer) |
| Go backend        | Go 1.22, modernc.org/sqlite (no CGo needed)                                            |
| Tests             | Vitest 5                                                                               |
| Python scripts    | Embedded in the Go binary via //go:embed                                               |

## UI conventions

- Look: Apple-like restraint, generous whitespace; neutral grays, color comes from posters. Accent blue only for focus, links and toggles; selected states use `--bg-active`.
- Tokens live in `src/renderer/src/assets/styles/tokens.css`. Never hard-code font sizes, radii, spacing, durations, z-index or shadows; `pnpm check:style` enforces it (`node scripts/style-tokens.mjs --fix` migrates values that match a token exactly).
  - Spacing (`padding` / `margin` / `gap` / `inset` / `top` / `right` / `bottom` / `left`): `--space-1..11` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80) plus half steps `--space-0_5` (2px) and `--space-6_5` (28px); negatives as `calc(var(--space-n) * -1)`. `0` and `1px` hairlines are fine; width/height are layout, not spacing. Snap off-grid values to the nearest step; a genuine layout offset gets `/* style-tokens: layout（reason） */` after the declaration.
  - Motion: `--duration-instant` 100ms (press), `-fast` 150ms (hover/fade), `-normal` 240ms (dialogs/panels), `-slow` 350ms (width/progress), `-spin` 800ms (spinners), `-pulse` 1.4s (pulses); easing `--ease-out` / `--ease-spring`. The fast/normal/slow/instant durations drop to 0 under reduced motion.
  - Layers: local `--z-raised` 2 < `--z-above` 5 < `--z-float` 10 < `--z-dropdown` 20 < `--z-popover` 30 < `--z-overlay` 40 < `--z-overlay-top` 45 (inside a component's stacking context), then Ant modal 1000 / message 1010 < `--z-bottom-nav` 1100 < `--z-drawer-backdrop` 1140 < `--z-drawer` 1150 < `--z-modal` 2000 < `--z-sheet` 2050 < `--z-lightbox` 2060 < `--z-settings` 2100 < `--z-dialog` 3000 < `--z-player-overlay` 6000 < `--z-max` 10000 (tooltip). A backdrop + window pair uses `calc(var(--z-…) + 1)` for the window. Only `0`, `1`, `-1`, `auto` may stay numeric.
  - Shadows: `--shadow-sm/md/lg`, `--focus-ring`, `--focus-ring-danger`, `--focus-ring-offset`.
- Shared controls live in `src/renderer/src/components/ui/`: `UiButton`, `UiIconButton` (icon + required `label`, shown as tooltip), `UiSegmented` (tabs), `UiNavItem` (sidebar / settings / tab-bar navigation; `collapsed` hides the label and shows it as tooltip, `layout="stack"` for the phone bottom bar, `current="page" | "pressed" | "none"`), `UiListRow` (clickable multi-line row; `role` / `aria-*` pass through, e.g. `menuitemradio`), `UiChip` (small gray pill for actors/tags; put a separate `UiIconButton` next to it for remove), `UiPressable` (unstyled button for image/card targets; pass `label` when the content has no text), `UiPosterCard` + `.ui-poster-grid`, `UiIcon`, `v-tooltip`.
- No raw `<button>` in `.vue` files outside `components/ui/` — pick one of the components above (`UiPressable` when nothing else fits). `pnpm check:style` fails on violations.
- Form controls: `UiInput` (`size` sm/md, `variant` default/filled, `icon` / `#leading`, `clearable` + `@clear`, `invalid`), `UiTextarea` (`autosize`), `UiSelect` (`options` or `<option>` slot), `UiSwitch`, `UiCheckbox`, `UiRadio`. They accept `v-model` or `:value`/`:checked` + native events; `UiInput`/`UiSelect` put `class` on the wrapper and every other attr/listener on the native element, and expose `focus()`. No raw `<input>` / `<select>` / `<textarea>` outside `components/ui/` except `type="file|range|hidden"` — `pnpm check:style` enforces it.
- No static `style="..."` in templates (use a class + tokens; dynamic `:style` is fine) and no emoji as status icons (use `UiIcon` or plain text) — `pnpm check:style` enforces the inline-style rule.
- Ant `message` / `notification` / `Modal.confirm` take their theme from `utils/theme.ts` (read from tokens.css) and their look from `assets/styles/antd-overrides.css`; use `confirmDialog` from `utils/confirm-dialog.ts` for confirmations.
- New `components/ui` styles wrap state/modifier selectors in `:where()`, so a single page class overrides sizing and colors.
- Prefer `UiIconButton` over text buttons; keep at most one `UiButton variant="primary"` per area (e.g. Play).
