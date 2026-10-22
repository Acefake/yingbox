# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/Mac) for media resource management, online streaming, and metadata scraping. It has a Vue 3 + TypeScript frontend, an Electron main-process shell, and an engine `utilityProcess` for online sources, MissAV and downloads.

## Common commands

```bash
# Dev (Electron + renderer HMR)
pnpm dev

# Type checking
pnpm typecheck          # node (tsc), web (vue-tsc) and tests (vue-tsc)
pnpm typecheck:node     # tsc for main/preload
pnpm typecheck:web      # vue-tsc for renderer
pnpm typecheck:tests    # vue-tsc for tests/ (tsconfig.tests.json)

# Lint / format
pnpm lint               # eslint --cache --max-warnings 0（warning 也算失败）+ check:size --strict（单文件 ≤ 400 行，无豁免）
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

- `config.ts` — Reads `userData/config.json` (`downloadPath`; no UI sets it yet), validates writability (write probe) on load
- `engine/` — Hosts the engine utilityProcess (online sources, MissAV, downloads), started on demand
- `plugins/` — Host for external programs (`host.ts`, `process.ts`) plus `plugins/lada/` (de-mosaic: rules / tools / temp / lock / job / cache / resume / range / live / live-media)
- `ipc/` — IPC channel registrations:
  - `dialog-ipc.ts` — `dialog:*` (openDirectory, selectDirectory, openFile), `shell:openPath`
  - `app-ipc.ts` — `win:*`, `app:networkIps`, `update:*` (electron-updater status via `update:status`)
  - `subtitle-ipc.ts` — `subtitle:find/read` (only accepts `local://` URLs)
- `local://` protocol handler for streaming local video files to the unified renderer player
- DevTools shortcuts: F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)

**Preload** ([src/preload/index.ts](src/preload/index.ts)) exposes `window.api` generated from the single contract in `src/shared/contract` (one domain per file; no generic file / http / path channels). The preload is **sandboxed**: only `electron` may be imported — never add npm imports here.

### Renderer: Vue 3 SPA

Routes (defined in [src/renderer/src/router/routers.ts](src/renderer/src/router/routers.ts)):

- `/` → Online search & streaming ([features/online/views/OnlineView.vue](src/renderer/src/features/online/views/OnlineView.vue))
- `/movie` → Movie library ([features/library/MovieLibraryPage.vue](src/renderer/src/features/library/MovieLibraryPage.vue)), TMDB libraries only
- `/jav` → 番号 library ([features/library/JavLibraryPage.vue](src/renderer/src/features/library/JavLibraryPage.vue)), `source: 'jav'` libraries, actors view and 番号 site settings; adult mode only
- `/tv` → TV library ([features/library/TvLibraryPage.vue](src/renderer/src/features/library/TvLibraryPage.vue))
- `/av` → Adult video resources online playback ([features/av/views/AvView.vue](src/renderer/src/features/av/views/AvView.vue))
- `/player-popout` → Dedicated player window ([features/player/views/PlayerPopout.vue](src/renderer/src/features/player/views/PlayerPopout.vue))

`App.vue` wraps routes in `AppLayout` with `<keep-alive>`. `DetailWindow` renders inline as the online content page.

Key directories under `src/renderer/src/`:

- `features/<x>/` — non-library features, each self-contained (`views/ components/ composables/ api/ utils/`): `online`, `av`, `download`, `lada`, `player`, `settings`, `shell`. Cross-feature imports only via `features/<x>/index.ts` (eslint `yingbox/feature-boundaries`); `main.ts` / `App.vue` / `router/` compose features and may point at view files for lazy routes
- `features/library/` — movie / TV / 番号 library UI on top of the library engine (`src/main/library`, `window.api.library`); 番号 scraping is the TS implementation in `src/main/library/providers/jav/` (it replaced the former Amane sidecar), see [docs/library-server.md](docs/library-server.md). The detail page also starts lada de-mosaic (`detail/use-restore.ts`)
- TMDB token — settings secret `scrape.tmdbToken`, write-only from the renderer (`setTmdbToken`); TMDB requests use `online.tmdb(path, query)`, the engine adds the token (see `src/main/tmdb.ts`)
- `composables/` — Global composables:
  - `use-context-menu.ts` — MenuItem interface definition
- `components/` — Shared UI: page chrome (`PageHeader`, `DialogTitlebar`, `StatusState`); reusable controls in `components/ui/`, including the imperative `toast` and `confirmDialog` (no Ant Design).
- `types/window-api.d.ts` — `window.api` type (generated from the contract, plus `library`)
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
- **TypeScript:** `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny` are enabled; no `any` (lint warns, and warnings fail `pnpm lint`); functions declare return types, composables export a `UseXxxReturn` interface
- **External data** (plugin / CMS / TMDB responses, old localStorage records): type it `unknown` and narrow with `utils/json.ts` (`asRecord` / `asArray` / `asText`); raw plugin/CMS shapes and parsers shared by online and AV live in `utils/vod-data.ts`
- Vue SFC `<script>` blocks must use `lang="ts"`

### Tech stack summary

| Layer             | Technology                                 |
| ----------------- | ------------------------------------------ |
| Desktop shell     | Electron 37                                |
| Build tooling     | electron-vite 5, Vite 7                    |
| Renderer          | Vue 3.5, TypeScript 5.9, vue-router 4      |
| UI kit            | own `components/ui/`, Tailwind CSS 4       |
| Metadata          | @tdanks2000/tmdb-wrapper                   |
| Engine            | Electron utilityProcess, `net.fetch`       |
| Library           | utilityProcess engine, `node:sqlite`       |
| CatSpider runtime | cheerio, crypto-js (engine plugin sandbox) |
| Package manager   | pnpm                                       |

## UI conventions

- Look: Apple-like restraint, generous whitespace; neutral grays, color comes from posters. Accent blue only for focus, links and toggles; selected states use `--bg-active`.
- Tokens live in `src/renderer/src/assets/styles/tokens.css`. Never hard-code font sizes, radii, spacing, durations, z-index or shadows; `pnpm check:style` enforces it (`node scripts/style-tokens.mjs --fix` migrates values that match a token exactly).
  - Spacing (`padding` / `margin` / `gap` / `inset` / `top` / `right` / `bottom` / `left`): `--space-1..11` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80) plus half steps `--space-0_5` (2px) and `--space-6_5` (28px); negatives as `calc(var(--space-n) * -1)`. `0` and `1px` hairlines are fine; width/height are layout, not spacing. Snap off-grid values to the nearest step; a genuine layout offset gets `/* style-tokens: layout（reason） */` after the declaration.
  - Motion: `--duration-instant` 100ms (press), `-fast` 150ms (hover/fade), `-normal` 240ms (dialogs/panels), `-slow` 350ms (width/progress), `-spin` 800ms (spinners), `-pulse` 1.4s (pulses); easing `--ease-out` / `--ease-spring`. The fast/normal/slow/instant durations drop to 0 under reduced motion.
  - Layers: local `--z-raised` 2 < `--z-above` 5 < `--z-float` 10 < `--z-dropdown` 20 < `--z-popover` 30 < `--z-overlay` 40 < `--z-overlay-top` 45 (inside a component's stacking context), then `--z-bottom-nav` 1100 < `--z-drawer-backdrop` 1140 < `--z-drawer` 1150 < `--z-modal` 2000 < `--z-sheet` 2050 < `--z-lightbox` 2060 < `--z-settings` 2100 < `--z-dialog` 3000 < `--z-player-overlay` 6000 < `--z-max` 10000 (tooltip). `toast` and `confirmDialog` live in the browser top layer (popover / modal `<dialog>`), above every z-index. A backdrop + window pair uses `calc(var(--z-…) + 1)` for the window. Only `0`, `1`, `-1`, `auto` may stay numeric.
  - Shadows: `--shadow-sm/md/lg`, `--focus-ring`, `--focus-ring-danger`, `--focus-ring-offset`.
- Shared controls live in `src/renderer/src/components/ui/`: `UiButton`, `UiIconButton` (icon + required `label`, shown as tooltip), `UiSegmented` (tabs), `UiNavItem` (sidebar / settings / tab-bar navigation; `collapsed` hides the label and shows it as tooltip, `layout="stack"` for the phone bottom bar, `current="page" | "pressed" | "none"`), `UiListRow` (clickable multi-line row; `role` / `aria-*` pass through, e.g. `menuitemradio`), `UiChip` (small gray pill for actors/tags; put a separate `UiIconButton` next to it for remove), `UiPressable` (unstyled button for image/card targets; pass `label` when the content has no text), `UiPosterCard` + `.ui-poster-grid`, `UiIcon`, `v-tooltip`.
- Long lists (unbounded: infinite scroll, aggregated search, favourites, queues) go through `UiVirtualGrid` (`class` = the grid/list class, `:items`, `:item-key`, default slot `{ item }`; `tag="ul"` for lists). It reads the column count from `grid-template-columns`, needs rows of equal height, and owns the container's vertical padding. `tests/virtual-lists.test.ts` lists the wired lists.
- Posters/covers pass `thumb` to `UiPosterCard`: the `<img>` loads `yingbox-media://thumb/?w=&src=` (`services/thumbnails`). Main (`src/main/thumbnails`) fetches the original, resizes with `nativeImage` (WebP originals decoded by wasm first), encodes WebP in a `worker_threads` worker (`@jsquash/webp`) and caches it in `userData/library/media/thumb` (one 512 MB LRU shared with the library's `yingbox-media://image/<key>?w=` thumbnails). Sources: http(s) and local `file:///…` images. On error the card falls back to the original URL.
- No raw `<button>` in `.vue` files outside `components/ui/` — pick one of the components above (`UiPressable` when nothing else fits). `pnpm check:style` fails on violations.
- New `components/ui` styles wrap state/modifier selectors in `:where()`, so a single page class overrides sizing and colors.
- Prefer `UiIconButton` over text buttons; keep at most one `UiButton variant="primary"` per area (e.g. Play).
