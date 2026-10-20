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

# Tests
pnpm test               # vitest run (tests/ — main-process pure logic)

# Build
pnpm build              # typecheck + electron-vite build
pnpm build:nocheck      # skip typecheck
pnpm build:win          # full Windows installer (zip)
pnpm build:win:full     # full Windows installer (NSIS)
pnpm build:mac          # full macOS installer

# Start preview (no hot-reload, production-like)
pnpm start

# Check for issues after refactoring
pnpm check              # run all checks (typecheck, lint, etc.)
pnpm check:fix          # run checks and auto-fix lint issues
```

## Architecture

The app runs as a **frameless Electron window** (1200×900 minimum). IPC is the boundary: the main process owns all OS access (filesystem, dialogs, shell, HTTP requests, child processes). The renderer is a single-page Vue 3 app with five routes.

### Three-process layout (electron-vite)

```
src/main/index.ts    → Electron main process (out/main/index.js)
src/preload/index.ts → Preload script (context bridge → window.api)
src/renderer/        → Vue 3 SPA (out/renderer/)
```

Path aliases (defined in `electron.vite.config.ts` and `tsconfig.*.json`):

- `@renderer` / `@` → `src/renderer/src`
- `@main` → `src/main`
- `@preload` → `src/preload`
- `@shared` → `src/shared`

Dev server runs on `127.0.0.1:3000`. There is no dev proxy: TMDB is called from the renderer; online sources go through the engine (`window.api.online` etc.).

**Main process** ([src/main/index.ts](src/main/index.ts)) bootstraps the window and wires per-domain modules:

- `config.ts` — Reads/writes `userData/config.json` (`downloadPath`), validates writability (write probe) on load and set
- `engine/` — Hosts the engine utilityProcess (online sources, MissAV, downloads), started on demand
- `ipc/` — IPC channel registrations:
  - `file-ipc.ts` — `file:*` (read, write, delete, exists, mkdir, readdir, scanMediaDirectory, stat, copy, move, readImage) and `path:*` (join, resolve, dirname, basename, extname)
  - `http-ipc.ts` — `http:*` (fetch for JSON, fetchImage to bypass hotlink, download)
  - `dialog-ipc.ts` — `dialog:*` (openDirectory, selectDirectory, openFile, saveFile), `config:setDownloadPath`, `shell:openPath`
  - `app-ipc.ts` — `win:*`, `app:*`, `update:*` (electron-updater status via `update:status`)
  - `subtitle-ipc.ts` — `subtitle:find/read` (only accepts `local://` URLs)
- `local://` protocol handler for streaming local video files to the unified renderer player
- DevTools shortcuts: F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)

**Preload** ([src/preload/index.ts](src/preload/index.ts)) exposes `window.api` with namespaced methods: `file.*`, `http.*`, `path.*`, `dialog.*`, `config.*`, `app.*`, `update.*`, `shell.*`, `win.*`, `player.*`, `subtitle.*`. Types are in [src/preload/index.d.ts](src/preload/index.d.ts). The preload is **sandboxed**: only `electron` may be imported — never add npm imports here.

### Renderer: Vue 3 SPA

Routes (defined in [src/renderer/src/router/routers.ts](src/renderer/src/router/routers.ts)):

- `/` → Online search & streaming ([features/online/views/OnlineView.vue](src/renderer/src/features/online/views/OnlineView.vue))
- `/movie` → Movie file management & scraping ([views/Movie/index.vue](src/renderer/src/views/Movie/index.vue))
- `/tv` → TV show file management & scraping ([views/TV/index.vue](src/renderer/src/views/TV/index.vue))
- `/av` → Adult video resources online playback ([features/av/views/AvView.vue](src/renderer/src/features/av/views/AvView.vue))
- `/player-popout` → Dedicated player window ([features/player/views/PlayerPopout.vue](src/renderer/src/features/player/views/PlayerPopout.vue))

`App.vue` wraps routes in `AppLayout` with `<keep-alive>`. `DetailWindow` renders inline as the online content page.

Key directories under `src/renderer/src/`:

- `features/<x>/` — non-library features, each self-contained (`views/ components/ composables/ api/ utils/`): `online`, `av`, `download`, `amane`, `lada`, `player`, `settings`, `shell`. Cross-feature imports only via `features/<x>/index.ts` (eslint `yingbox/feature-boundaries`); `main.ts` / `App.vue` / `router/` compose features and may point at view files for lazy routes
- `api/tmdb.ts` — TMDB wrapper (library)
- `stores/` — localStorage-backed settings (no Pinia): `scrape-provider-store` (provider config + tokens persisted as `scrapeProviderConfig`)
- `composables/` — Global composables:
  - `use-global-queue.ts` — Module-level singleton task queue with concurrent processing (max 3), dedup, progress tracking, cancellation
  - `use-error-handler.ts` — `safeExecute` / `safeExecuteSync` wrappers with Ant Design message toasts
  - `use-context-menu.ts` — MenuItem interface definition
- `views/Movie/composables/` — Movie-specific: `use-file-management`, `use-scraping`, `use-media-processing`, `use-scraping-task`
- `views/TV/composables/` — TV-specific: `use-tv-file-management`, `use-tv-scraping`
- `components/` — Shared UI: page chrome (`PageHeader`, `DialogTitlebar`, `StatusState`), `ScrapeQueuePanel` (library); reusable controls in `components/ui/`. `components/UnifiedVideoPlayer.vue` and `composables/use-media-player.ts` / `use-lada-tasks.ts` are re-exports kept for the library views (delete after the library merge)
- `types/` — TypeScript interfaces: `ProcessedItem`, `FileItem`, `ActorInfo`, `MovieInfoType`, `EpisodeInfo`, `SeasonInfo`, `TVShowInfoType`
- `directives/` — Custom Vue directives: `v-context-menu`, `v-scroll-x`

### Engine ([src/engine/](src/engine/))

The former Go backend (port 31471) was removed in p3d; its routes now live in engine domains `online`, `av` and `download`, run in an Electron utilityProcess. See AGENTS.md.

### App settings

User settings are stored in `localStorage` (renderer side). Key keys:

- `scrapeProviderConfig` — provider type, TMDB token, MetaTube config (legacy backend URL kept for the library mirror)
- `imageDownloadSize_poster` / `imageDownloadSize_backdrop` / `imageDownloadSize_actor`
- `folderContent_fileData` / `folderContent_currentPath` — file tree cache
- `metadataLanguage`

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

| Layer             | Technology                                                        |
| ----------------- | ----------------------------------------------------------------- |
| Desktop shell     | Electron 37                                                       |
| Build tooling     | electron-vite 5, Vite 7                                           |
| Renderer          | Vue 3.5, TypeScript 5.9, vue-router 4                             |
| UI kit            | Ant Design Vue 4.x, Tailwind CSS 4                                |
| Metadata          | @tdanks2000/tmdb-wrapper                                          |
| CatSpider runtime | cheerio, crypto-js (required by `backend/py/catspider_runner.js`) |
| Go backend        | Go 1.22, modernc.org/sqlite (no CGo needed)                       |
| Python scripts    | Embedded in Go binary via //go:embed                              |
| Package manager   | pnpm                                                              |

## UI conventions

- Look: Apple-like restraint, generous whitespace; neutral grays, color comes from posters. Accent blue only for focus, links and toggles; selected states use `--bg-active`.
- Tokens live in `src/renderer/src/assets/styles/tokens.css`. Never hard-code font sizes, radii, spacing, durations, z-index or shadows; `pnpm check:style` enforces it (`node scripts/style-tokens.mjs --fix` migrates values that match a token exactly).
  - Spacing (`padding` / `margin` / `gap` / `inset` / `top` / `right` / `bottom` / `left`): `--space-1..11` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80) plus half steps `--space-0_5` (2px) and `--space-6_5` (28px); negatives as `calc(var(--space-n) * -1)`. `0` and `1px` hairlines are fine; width/height are layout, not spacing. Snap off-grid values to the nearest step; a genuine layout offset gets `/* style-tokens: layout（reason） */` after the declaration.
  - Motion: `--duration-instant` 100ms (press), `-fast` 150ms (hover/fade), `-normal` 240ms (dialogs/panels), `-slow` 350ms (width/progress), `-spin` 800ms (spinners), `-pulse` 1.4s (pulses); easing `--ease-out` / `--ease-spring`. The fast/normal/slow/instant durations drop to 0 under reduced motion.
  - Layers: local `--z-raised` 2 < `--z-above` 5 < `--z-float` 10 < `--z-dropdown` 20 < `--z-popover` 30 < `--z-overlay` 40 < `--z-overlay-top` 45 (inside a component's stacking context), then Ant modal 1000 / message 1010 < `--z-bottom-nav` 1100 < `--z-drawer-backdrop` 1140 < `--z-drawer` 1150 < `--z-modal` 2000 < `--z-sheet` 2050 < `--z-lightbox` 2060 < `--z-settings` 2100 < `--z-dialog` 3000 < `--z-player-overlay` 6000 < `--z-max` 10000 (tooltip). A backdrop + window pair uses `calc(var(--z-…) + 1)` for the window. Only `0`, `1`, `-1`, `auto` may stay numeric.
  - Shadows: `--shadow-sm/md/lg`, `--focus-ring`, `--focus-ring-danger`, `--focus-ring-offset`.
- Shared controls live in `src/renderer/src/components/ui/`: `UiButton`, `UiIconButton` (icon + required `label`, shown as tooltip), `UiSegmented` (tabs), `UiNavItem` (sidebar / settings / tab-bar navigation; `collapsed` hides the label and shows it as tooltip, `layout="stack"` for the phone bottom bar, `current="page" | "pressed" | "none"`), `UiListRow` (clickable multi-line row; `role` / `aria-*` pass through, e.g. `menuitemradio`), `UiChip` (small gray pill for actors/tags; put a separate `UiIconButton` next to it for remove), `UiPressable` (unstyled button for image/card targets; pass `label` when the content has no text), `UiPosterCard` + `.ui-poster-grid`, `UiIcon`, `v-tooltip`.
- No raw `<button>` in `.vue` files outside `components/ui/` — pick one of the components above (`UiPressable` when nothing else fits). `pnpm check:style` fails on violations.
- New `components/ui` styles wrap state/modifier selectors in `:where()`, so a single page class overrides sizing and colors.
- Prefer `UiIconButton` over text buttons; keep at most one `UiButton variant="primary"` per area (e.g. Play).
