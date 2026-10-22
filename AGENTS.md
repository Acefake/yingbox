# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Overview

影盒 (yingbox) is an Electron desktop app (Windows/macOS) for media library management:

- **本地媒体库** — scans movie/TV folders, scrapes TMDB metadata, writes Kodi-standard NFO + images
- **在线播放** — aggregates CMS sites (`cms-sites.json`) and CatSpider plugin sites, resolves play URLs in the engine (`src/engine/online`)
- **内置播放器** — dedicated player window: local files streamed over `local://` (HTTP Range), HLS/m3u8, auto-mounted sidecar subtitles (srt/ass → WebVTT)

Stack: Electron 37 shell + Vue 3 SPA + an engine `utilityProcess` (`src/engine/`: online sources, MissAV, HLS downloads) reached through the IPC contract. The desktop app has no HTTP backend and no Go/Python runtime. The one HTTP backend is the optional standalone **library server** (`src/server/`, see below and `docs/library-server.md`) that serves the media library to the web build / NAS; the desktop app never talks to it.

## Common commands

```bash
pnpm dev            # Electron (engine starts on demand)
pnpm typecheck      # tsc (main/preload) + vue-tsc (renderer) + vue-tsc (tests)
pnpm lint           # eslint --cache + check:size --strict
pnpm test           # vitest run (tests/)
pnpm test:affected  # only tests affected by changes vs origin/main (see Engineering gates)
pnpm format         # prettier --write .
pnpm build          # typecheck + electron-vite build
pnpm build:nocheck  # electron-vite build only
pnpm build:win      # Windows zip
pnpm build:win:full # Windows NSIS installer
pnpm build:mac      # macOS dmg
pnpm check          # scripts/check-issues.sh
pnpm check:case     # import case-sensitivity check (Windows-safe against mac/Linux breakage)
pnpm check:copy     # copy / comments describe the final state only (ratchet baseline)
pnpm start          # electron-vite preview (production-like)
pnpm dev:server     # standalone library server (tsx watch, 127.0.0.1:31480)
pnpm dev:web        # web build; proxies /api and /media to the library server
pnpm build:server   # → out/server/server.js
pnpm build:web      # → dist-web/
pnpm smoke:server   # offline end-to-end smoke of the library server (fixture fetch)
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
- `download-dir.ts` — download directory = setting `download.dir` (empty → `Videos/影盒下载`); `settings.chooseDownloadDir` opens the folder dialog, write-probes the folder, saves it; migrates the legacy `userData/config.json` `downloadPath` once and deletes that file
- `utility/host.ts` — `UtilityHost`, the lifecycle shared by both utilityProcess hosts (`engine/host.ts`, `library/engine-host.ts`): on-demand fork, `onStart` before any call, ready timing, id-matched call table, crash → pending calls fail → next call re-forks, shutdown with kill timeout (calls during a shutdown wait for the old process), optional idle exit. Both children speak one wire protocol, `src/shared/utility/protocol.ts` (`call`/`result`, `ready`, `event`, `host`/`reply`, `busy`, `subscribe`, `shutdown`); each side keeps its own method table (engine: contract channels + `HostMethods` in `src/engine/protocol.ts`; library: `LibraryRpcMap`, params in `args[0]`)
- `engine/` — hosts the engine `utilityProcess` on `UtilityHost` (on demand, MessagePort RPC); `browser-fetch/` fetches Cloudflare-protected pages for the engine: a host whose challenge a window passed within the last 25 min is fetched with `session.fetch` on the same partition / UA (raw HTML, no window, concurrent); otherwise, or when that returns a challenge page, a hidden Chromium window renders it (serial; only passable challenges are ever shown; hard blocks such as 1020 / "Sorry, you have been blocked" destroy the window unseen and trip a per-host 30-min breaker, on either path); `media-headers.ts` injects Referer for direct stream/cover requests
- `plugins/` — plugin host for lada / mpv: `host.ts` (register stop/health, prefixed logs, quit cleanup that waits for every running plugin) and `process.ts` (kill process tree, wait for exit, line log relay, one-shot `runTool`). Plugin code lives beside them: `plugins/lada/` (rules / tools / temp / lock / job / cache / resume / range / live / live-media); pure rules sit in each `rules.ts` with tests. Both start on demand; do not add `app.on('before-quit')` elsewhere in `src/main` (a test enforces it)
- `ipc/` — per-domain IPC registrations, called from `index.ts`:
  - `dialog-ipc.ts` (`dialog:*`, `shell:openPath`)
  - `app-ipc.ts` (`win:*`, `app:networkIps`, `update:*` + electron-updater status events)
  - The renderer has no generic `file:*` / `http:*` / `path:*` / `config:*` channels (removed: no callers). Add a narrow domain method when a feature needs one
  - `subtitle-ipc.ts` (`subtitle:find/read`; only accepts `local://` URLs)
- `file-operations.ts` — atomic write (temp file + replace, per-path locks)
- `http-client.ts` — SSRF-guarded fetch for main's own requests (subtitles, thumbnail originals): private-IP blocking incl. DNS resolution, manual redirect hops, size-limited reads
- `local-media.ts` — `local://` URL ↔ filesystem path + HTTP Range streaming (206/416)
- `media-scanner.ts` — incremental library scan (directory-mtime short-circuit + cache reuse)
- `player-window.ts` — singleton player window; normalizes payloads, caps playlists at 500 items; `player.setCompact` shrinks it to the bottom-right corner, always on top (mpv: `mpv.setCompact`, `mpv-window.ts`)
- `subtitle.ts` — sidecar subtitle discovery, encoding detection (UTF-8/UTF-16/GB18030), srt/ass → WebVTT

### Preload (`src/preload/index.ts`)

Exposes `window.api` only, namespaced: `file.* http.* path.* dialog.* config.* app.* update.* shell.* win.* player.* subtitle.*`. Types: `src/preload/index.d.ts`.

**Sandboxed preload:** only `electron` may be imported — no npm packages (a sandboxed preload cannot `require` them).

### Renderer (`src/renderer/src/`)

Routes (`router/routers.ts`): `/` online, `/movie`, `/tv`, `/jav` (本地番号库, adult mode only), `/av`, `/player-popout`; catch-all → `/`. Routes with `meta.adultOnly` (`/jav`, `/av`) are redirected to `/` by the router guard (`router/adult-guard.ts`) while adult mode is off.

- `features/<x>/` — one folder per non-library feature (`views/ components/ composables/ api/ utils/` inside): `online` (CMS/CatSpider search, `DetailWindow`, data-source panel), `av` (MissAV), `download`, `lada`, `player` (`UnifiedVideoPlayer`, mpv/popout, play progress, `mini/` in-app mini player: in-page players hand the same instance to it on leaving a detail and claim it back), `settings` (panel + section registry), `shell` (`AppLayout`). Features import each other only through `features/<x>/index.ts` (eslint `yingbox/feature-boundaries`, `scripts/eslint/feature-boundaries.mjs`); the composition layer (`main.ts`, `App.vue`, `router/`) may point at view files directly so routes stay lazy. Feature-owned settings sections are registered in `main.ts` with an `order`.
- TMDB token: secret `scrape.tmdbToken` (main-process safeStorage), write-only from the renderer (`setTmdbToken` / `tmdbTokenConfigured` in `@/features/settings`; there is no `readSecret`). TMDB requests go through `online.tmdb(path, query)` (`features/online/api/online.ts`); the background engine asks main for the token (host method `tmdbToken`, falls back to the `YINGBOX_TMDB_TOKEN` / `VITE_TMDB_ACCESS_TOKEN` env vars at runtime). Main pushes the token to the library engine on save and at startup (`src/main/tmdb.ts`). Renderer code must not call `fetch` directly (eslint; only `services/library-server` is exempt)
- `features/library/` — movie / TV library UI (poster wall, video wall, detail, match review, writer / organize, library settings), talking to the library engine through `api/bridge.ts`: on desktop `window.api.library` (`src/preload/library-bridge.ts`, its own invoke channel + MessagePort event stream, not part of the generic contract; main owns the event ports: a window registers with `library:subscribe`, main (`src/main/library/engine-host.ts`, on `UtilityHost`: `onStart` reconnects every subscriber before any call reaches a new engine; no idle exit, shutdown killed after 5 s) pushes a port on `library:port` and pushes a fresh one to every subscribed window whenever the engine is re-forked after a crash, so subscriptions survive engine restarts), on the web the HTTP transport to the library server
- shared: `components/ui/` (design system), `components/` (page chrome, `StatusState`), `composables/` (`use-context-menu`, `use-escape-layer`, `use-platform`), `utils/`
- Card hover preview: `components/ui/hover-preview/` (one controller app-wide: delay from settings `ui.hoverPreview` / `ui.hoverPreviewDelay`, wired in `main.ts`; one shared muted `<video>` / `<img>`, released with `src` removed + `load()`; stops on leave, scroll-out (IntersectionObserver), unmount / keep-alive deactivate, hidden window, multi-select; never autoplays under `prefers-reduced-motion`). `UiPosterCard` takes a `preview` source; the library wall binds it once on the grid (`useGridPreview`). Sources: Douban cards → trailer mp4 from the engine (`online.doubanTrailer`, `src/engine/online/douban-trailer.ts`: rexxar API then trailer page, memory + `userData/online/douban-trailers.json` cache incl. "no trailer", per-host breaker; `*.doubanio.com` Referer from `media-headers.ts`); library wall → library RPC `getPreview` (`src/main/library/catalog/item-preview.ts`: first video file over `local://` from 10 % for 6 s, or only cached images for cloud-mode libraries). Online search cards have no source yet

### Engine (`src/engine/`)

Runs in an Electron `utilityProcess`, started on first use by `src/main/engine`, and stopped again after 5 idle minutes (`ENGINE_IDLE_MS` in `src/main/engine/host.ts`): idle means no call in flight and the engine has not reported `busy` (the download queue reports busy while a task is running or queued). The next call waits for the old process to exit, then forks a fresh one; a shutdown that takes longer than 5 s is killed. Domains: `online` (CMS sites, CatSpider plugins, VOD parse, Douban browse: `online.doubanBrowse(query, start)` in `online/douban-browse.ts` — quick tags → `movie.douban.com/j/search_subjects`, any genre / region / era / sort / min-rating filter → `m.douban.com/rexxar/api/v2/<movie|tv>/recommend`; the query whitelist is `src/shared/douban/query.ts`, pages cached 10 min, per-host breaker; the renderer side is `features/online/composables/use-douban-feed.ts`: module singleton, infinite scroll via `UiVirtualGrid` `reach-end`, de-dup by subject URL, query remembered in `sessionStorage`), `av` (MissAV catalogue + resolver), `download` (site → m3u8 lookup, HLS download with AES-128, JSON atomic queue in `userData/downloads/queue.json`, optional ffmpeg remux). All outbound HTTP goes through `src/shared/net` (SSRF guard); `cf-page.ts` classifies challenge vs hard-block pages and `host-breaker.ts` is the per-host breaker, both shared with the main process. Plugin sources that trip report `unavailable` to the renderer, which skips them in search and marks them in the source list. Replaces the former Go backend on 127.0.0.1:31471, removed in p3d. cheerio is loaded on first HTML parse only, through `src/shared/html/cheerio.ts` (both utilityProcesses and the standalone server); elsewhere import it as `import type` only. The CatSpider `$cache` is per plugin and persisted under `userData/online/plugin-storage/` (`online/plugin-storage.ts`: one file per plugin URL, 30-day TTL, 256 KB per plugin, atomic writes).

Downloads resume (`src/engine/download/resume.ts`). HLS writes `<file>.partial` plus a `.partial.segs` log (playlist fingerprint, then one `index size sha1` line per written unit); on restart it re-hashes the written units, truncates to the last good one and continues. Links ending in `.mp4`-style extensions go to `direct.ts`, which keeps `.partial.json` (ETag / Last-Modified / length) and resumes with `Range` + `If-Range`, starting over on 200 or a mismatched `Content-Range`. Each task records its download root (`DownloadTask.dir`) the first time it starts, and retries, resumes and removal use that root even after the setting changes (tasks that never started use the current one). Failures and cancels keep the temp files for the next attempt; removing a task deletes them; after `queue.load()` the engine sweeps the current root and every task's root (`sweep.ts`) and deletes `<code>.*.partial[.segs|.json]` inside valid-code folders that belong to no queued/active task and are untouched for 7 days; the ffmpeg remux writes `.mp4.partial` then renames. At startup main reads the queue file and wakes the engine when tasks are unfinished (`src/main/engine/pending-downloads.ts`).

### 番号库 replaces the Amane sidecar

The former Amane Python sidecar (`plugins/amane`, `features/amane`, the `packages/amane` submodule) has been removed. 番号 scraping, actors, library monitoring and auto-organize are the TypeScript implementation below and the library server; see [docs/library-server.md](docs/library-server.md). De-mosaic (lada) is started from the library item detail (`features/library/detail/use-restore.ts`, adult mode, desktop movies).

### 番号库（JAV 刮削）

A movie library can be added with `source: 'jav'` (「添加文件夹…」 in the settings of the separate 「番号」 page `/jav`; fixed at creation, migration v4 adds `libraries.source`). The renderer splits libraries into sections (`features/library/state/library-section.ts`): 电影 = movie + tmdb, 剧集 = tv, 番号 = movie + jav; every wall / review / count query carries `source` (`LibraryQuery.source`, filtered in `catalog/query.ts`), so 番号 items never show on the movie page. Links to an item or actor of another section (`?item=` / `?actor=`) are moved to the owning page by `page/use-section-guard.ts`. The scanner then parses a 番号 from each file name (`src/main/library/providers/jav/number.ts`; falls back to folder names) and groups files by it; identification skips TMDB search/scoring and asks the 番号 sites directly (`identify/runner-jav.ts`), no TMDB token needed. Sites live in `providers/jav/sites/` (javbus, avbase, fc2), fetched through `ProviderHttp.getText` (Electron `net.fetch`) with per-host breaker and Cloudflare page detection; `aggregate.ts` merges per field by the user's site priority (`jav.getSettings` / `jav.setSettings`, stored in `settings` as `provider.jav.settings`). For these items `media_items.tmdb_id` holds the 番号 and `matches.provider` is `jav`; image paths are absolute URLs (`TmdbProvider.imageUrl` passes them through); NFO writes `<uniqueid type="num">`. **演员库**（migration v6, `src/main/library/actors/`）: `actors` (one row per normalized name, aggregated profile JSON fields, `locked_fields`, `field_sources`, cached `photo`) + `item_actors` (top-level jav item ↔ actor, synced from metadata `cast` after identify / refresh / manual match; TMDB libraries are not linked). A low-priority cancellable `actor-profile` job looks up pending actors through `providers/jav/actors` (per-source cache `actor:<source>:<name>`: found 7 d, missing 1 d, errors not cached; sources picked by settings `actors.getSettings` and gender), merges with stored values (locked fields kept) and caches the first avatar via `ImageCache`; the gfriends index persists to `<dataDir>/gfriends-index.json`. IPC `actors.*` (contract `contract-actors.ts`, validation `validate-actors.ts`), `query({ actorId })` lists an actor's works, NFO `<actor>` gets the avatar thumb plus `birthdate/birthplace/height/measurements/cup`. UI: `features/library/actors/`. Behaviour is modelled on Amane's scrapers but independently implemented (no GPL code copied).

### Library server (`src/server/`, web / NAS)

The same library core runs in a plain Node process for the web build. Host differences live in `src/main/library/platform` (`LibraryPlatform` + `createLibraryService`; outbound fetch is `node` (undici) / `curl[:path]` (curl-impersonate) / `module:<path>`, picked by `YINGBOX_FETCH`). The server (`app.ts` wiring, `config.ts` flags/env, `http/` router + Bearer/Cookie auth + static, `routes/` library rpc + SSE, media, fs) exposes `POST /api/library/rpc` with exactly the IPC contract (validation reused from `engine/rpc.ts`), SSE `/api/library/events`, `/media/image|thumb|files` (Range) and `/api/fs/dirs` (confined to media roots); default bind `127.0.0.1:31480` (any other host needs an explicit ≥24-char token, `exposure.ts`; token sources in the doc). Thumbnails use the wasm pipeline (`thumbnails/wasm-resizer.ts`, codec worker) instead of `nativeImage`. In the renderer, `features/library/api/bridge.ts` picks IPC (`window.api.library`) or `http-bridge.ts`; `services/library-server` owns login/state/media URLs (the only other place allowed to `fetch`); web-only UI: `page/ServerConnect.vue`, `settings/FolderBrowser.vue`, `detail/WebPlayer.vue`. Wire format: `src/shared/library/ipc/contract-http.ts`. Deployment, config table, proxy: `docs/library-server.md`; Docker / NAS: `docs/deploy/nas.md` (ADR-0010). Checks: `scripts/smoke-server.mjs` (CI-able, offline), `scripts/web-e2e.mjs` (Playwright, manual).

### App settings

- localStorage: `scrapeProviderConfig` (provider, TMDB token; legacy backend URL/key kept only for the library mirror), `imageDownloadSize_*`, `folderContent_*` (tree cache), `metadataLanguage`, `player_playback_rate`
- Download directory: setting `download.dir` in `settings.json` (Settings → 下载, adult mode)
- Env: `VITE_TMDB_ACCESS_TOKEN` (or `YINGBOX_TMDB_TOKEN`) — optional dev-only default TMDB token, read by the main process / library engine at runtime; never commit a real one (see `.env.example`)

### Tests

`pnpm test` — Vitest (node env), `tests/` covers main-process pure logic: Range parsing, `local://` path mapping, subtitle decoding/conversion, SSRF IP classification, incremental scan reuse. Vue components are not unit-tested.

### Build pipeline

`electron-vite build` → `out/`; `electron-builder` → `dist/` (win nsis/portable/zip, mac dmg, linux AppImage/snap/deb). `extraResources` ships mpv only.

Build outputs (`out/`) are gitignored and untracked — regenerate with `pnpm build`.

### Tech stack

| Layer             | Technology                                                       |
| ----------------- | ---------------------------------------------------------------- |
| Desktop shell     | Electron 37 (sandboxed preload, frameless)                       |
| Build tooling     | electron-vite 5, Vite 7                                          |
| Renderer          | Vue 3.5, TypeScript 5.9, vue-router 4                            |
| UI kit            | own design system in `components/ui/`, Tailwind CSS 4            |
| Player            | Artplayer 5, hls.js                                              |
| Metadata          | @tdanks2000/tmdb-wrapper                                         |
| Engine            | Electron utilityProcess, `net.fetch`                             |
| Library           | utilityProcess engine, `node:sqlite`                             |
| CatSpider runtime | cheerio, crypto-js (required inside the engine's plugin sandbox) |
| Tests             | Vitest 5                                                         |

## Engineering gates

- **Affected tests while iterating:** `pnpm test:affected [--plan] [--base <ref>] [-- <vitest args>]` diffs the working tree (incl. untracked) against the merge-base with `origin/main`. Comment / whitespace / format-only edits are skipped (TS/JS compared as a TypeScript syntax-tree fingerprint; `.vue` per block; `.json` parsed); shared infrastructure (`package.json`, lockfile, vite / vitest / tsconfig / eslint config, `src/shared/**`, `scripts/**`, test setup) or a deleted source file runs everything; other code goes through vitest's import graph (`related`), plus every test marked `test-affected: repo-wide` (tests that read source text or run eslint — mark new ones the same way); non-code files run the tests that mention their name. **Before merging, run the full suite** (typecheck, `pnpm test`, build, `check:style` / `check:case` / `check:size`).
- **Ratchet baselines (only shrink):** `scripts/baselines/style-visual.json` (`check:style`: font weight 400/500/600 only, radius only `--radius-*` / `0` / `50%`, colors only tokens, selected states fill with `--bg-active` and add no border) and `scripts/baselines/copy-final-state.json` (`check:copy`: UI copy and comments state the final behaviour, no 改为 / 原先 / 之前是 / 旧版 comparisons). Fixing a violation means running the script with `--update-baseline` in the same change; a new violation fails. Per-line escapes: `/* style-tokens: visual（reason） */`, `copy-lint: ok`.
- **Dependencies:** new entries in `package.json` use exact versions; the caret ranges that predate the rule are listed in `scripts/baselines/dependency-ranges.json` and may only be pinned or removed (`tests/dev-gates/dependency-policy.test.ts`).
- **Context budget:** this file and `CLAUDE.md` have line / byte / longest-line budgets in `tests/dev-gates/context-budget.test.ts`. Move detail into `docs/` instead of growing them; raising a budget needs a dated entry with a reason.

## Decisions (ADR)

Settled decisions live in `docs/adr/` (背景 / 决策 / 后果 / 否决方案). **Changing one of them requires a new ADR** that supersedes it — do not silently redo or revert it.

- [0001](docs/adr/0001-keep-two-utility-processes.md) 两个 utilityProcess 不合并
- [0002](docs/adr/0002-no-impit.md) 不引入 impit 伪装 TLS 指纹
- [0003](docs/adr/0003-overseas-probe-not-source-failure.md) 海外探测失败不当作源失效（以国内实测为准）
- [0004](docs/adr/0004-cf-breaker-scope-persist.md) CF 熔断按主机 + 用途、落盘、硬封锁不弹窗
- [0005](docs/adr/0005-cf-session-fast-path.md) 过挑战后 25 分钟内走 session.fetch 快路径
- [0006](docs/adr/0006-download-resume-and-leftovers.md) 下载断点续传、任务记目录、7 天孤儿临时文件清扫
- [0007](docs/adr/0007-engine-idle-exit.md) 后台引擎空闲 5 分钟退出
- [0008](docs/adr/0008-scan-time-slicing.md) 媒体库扫描按 16 ms 时间片让出
- [0009](docs/adr/0009-utility-wire-protocol.md) 两个 utilityProcess 统一线协议
- [0010](docs/adr/0010-docker-nas-deploy.md) NAS / Docker：容器化片库服务、默认只听本机、入口降权
- [0011](docs/adr/0011-library-cloud-mode.md) 媒体库网盘模式与外部变更通知
- [0012](docs/adr/0012-library-job-followups.md) 媒体库任务后继写在任务定义里

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
- Form controls: `UiInput` (`size` sm/md, `variant` default/filled, `icon` / `#leading`, `clearable` + `@clear`, `invalid`), `UiTextarea` (`autosize`), `UiSelect` (`options` or `<option>` slot), `UiSwitch`, `UiCheckbox`, `UiRadio`. They accept `v-model` or `:value`/`:checked` + native events; `UiInput`/`UiSelect` put `class` on the wrapper and every other attr/listener on the native element, and expose `focus()`. No raw `<input>` / `<select>` / `<textarea>` outside `components/ui/` except `type="file|range|hidden"` — `pnpm check:style` enforces it.
- No static `style="..."` in templates (use a class + tokens; dynamic `:style` is fine) and no emoji as status icons (use `UiIcon` or plain text) — `pnpm check:style` enforces the inline-style rule.
- Feedback is imperative and comes from `@/components/ui`: `toast.success/error/warning/info(text)` (returns a dismiss function; `toast.loading(text)` stays until dismissed) and `await confirmDialog({ title, content, okText, danger, onOk })` → `boolean` (an `onOk` that throws keeps the dialog open and shows the error). `ant-design-vue` is gone and `import`ing it is a lint error.
- New `components/ui` styles wrap state/modifier selectors in `:where()`, so a single page class overrides sizing and colors.
- Waiting feedback, one kind per wait (`components/ui/feedback.ts`): a user-triggered wait is the `loading` spinner on `UiButton` / `UiIconButton` (stays focusable — `aria-busy` + `aria-disabled`, repeat clicks blocked, no `disabled`); background work is `UiLoadingDots`, placed after the content; a first-screen wait for known structure is `UiSkeleton` (poster grid, static under reduced motion); a known total is a real `role="progressbar"`. Refreshing or appending keeps the old content until the new content arrives (`listWaiting`), so the reader's scroll position never moves.
- Keys: Enter-to-submit on text fields uses `v-enter` (`@/directives/enter`), never `@keydown.enter`, so an IME commit (`isComposing` / keyCode 229) does not submit. Overlays close on Esc by registering `useEscapeLayer(() => open, close)` (`@/composables/use-escape-layer`): one Esc closes only the topmost layer, and never while the IME is composing. No per-component window keydown listeners and no direct `'Escape'` comparisons (`utils/keyboard.ts` has the helpers).
- Prefer `UiIconButton` over text buttons; keep at most one `UiButton variant="primary"` per area (e.g. Play).
