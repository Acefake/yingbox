# 统一发布实现计划

规格：[2026-11-03-unified-release-design.md](../specs/2026-11-03-unified-release-design.md)。

**目标**：推 `vX.Y.Z` 标签，GitHub Actions 构建 Windows / macOS / 安卓 / NAS，发布页只放安装包和 `sha256sum.txt`。

**全局约束**：中文提交说明；单文件 ≤ 400 行；函数写返回类型；不用 `any`；外部数据用 `src/shared/json.ts` 收窄；用户界面文案只写最终状态（`tests/dev-gates/copy-final-state.test.ts`）；每个任务结束跑所在模块测试，不提交（提交由用户授权）。

**与规格的两处差异（执行中发现，实现按此处为准）**

- 更新器校验用 GitHub 资产自带的 `digest`（服务端算的 SHA-256），不再额外下载 `sha256sum.txt`。后者仍随发布提供，供人工核对。
- mpv 源码包（1.19 GB）不进版本发布，单独放在固定发布 `mpv-sources-<id>` 里，只上传一次，版本发布说明里写链接。仓库自己的 `docs/release-licenses.md` 要求安装包旁提供对应源码，这样既满足它，发布页资产也只有安装包。

## 任务 1：共享发布规则（纯函数）

文件：新增 `src/shared/release/pick.ts`；修改 `src/shared/android/release.ts`；新增 `src/shared/desktop-update.ts`；修改 `tests/android-release.test.ts`；新增 `tests/desktop-update.test.ts`。

- `pick.ts`：导出 `parseVersion`、`compareVersions`、`sha256Of`（从 `android/release.ts` 搬出）和 `newestRelease<T>(releases, current, select)`。遍历发布列表，跳过草稿和 Pre-release，标签必须是 `vX.Y.Z`，版本比当前新，且 `select(assets, version)` 返回非空；取最新的一个。
- `android/release.ts`：`pickAndroidUpdate` 改为调用 `newestRelease`，按 ABI 选 `yingbox-android-X.Y.Z-<abi>.apk`；删除 `TAG` 常量和搬走的函数。
- `desktop-update.ts`：`pickDesktopUpdate(releases, current)` 选 `yingbox-setup-X.Y.Z.exe`，返回 `{ version, notes, url, size, sha256, publishedAt }`；大小 0 到 2 GiB，必须 https，必须有 sha256 digest。
- 测试：把版本比较、选包、草稿、Pre-release、缺 digest、缺包、旧标签 `android-v…` 不再命中等用例写成失败测试，先确认失败再实现。
- 验证：`pnpm vitest run tests/android-release.test.ts tests/desktop-update.test.ts`。

## 任务 2：Windows 更新器

文件：新增 `src/main/updater/desktop-updater.ts`；修改 `src/main/ipc/app-ipc.ts`、`src/main/settings/quit-flush.ts`（注释）、`package.json`、`electron-builder.yml`；删除 `dev-app-update.yml`；新增 `tests/desktop-updater.test.ts`。

- `createDesktopUpdater(deps)`：依赖注入 `fetch`、`dir`、`version`、`platform`、`spawn`、`quit`、`emit`。
  - `check()`：仅 `win32`；请求发布列表（缓存 10 分钟），`pickDesktopUpdate`；发出 `checking` / `available` / `not-available`；失败发出 `error`。
  - `download()`：写入 `dir/<文件名>.part`，边写边算 SHA-256 并发出 `downloading`（`percent`）；校验通过后改名并发出 `downloaded`；不一致删除并报错。
  - `install()`：`spawn(file, ['--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()`，随后 `quit()`。
- `app-ipc.ts`：用它替换 `autoUpdater`，`checkForUpdatesOnStartup` 改调 `check()`。
- 依赖与配置：`pnpm remove electron-updater`；`electron-builder.yml` 删除 `publish`、设 `nsis.artifactName: yingbox-setup-${version}.${ext}` 与 `differentialPackage: false`。
- 测试（假 `fetch` 返回 `Response`）：无更新；有更新；下载成功；校验失败删文件；下载中断；非 Windows 返回错误；`install` 只在已下载后调用 `spawn`。
- 验证：`pnpm vitest run tests/desktop-updater.test.ts`，`pnpm typecheck:node`。

## 任务 3：安卓更新器读统一发布

文件：修改 `src/server/view/app-update.ts`（注释与默认地址说明）、`docs/tv/android-release.md`；确认 `tests/android-release.test.ts` 通过。

- 服务端更新检查已走 `pickAndroidUpdate`，只需确认它按任务 1 的规则取包、注释不再提 `android-v` 标签。
- `docs/tv/android-release.md` 改写为：由工作流发布，本机只用于本地验证。

## 任务 4：发布脚本（纯 Node，可测试）

文件：新增 `scripts/release/checksums.mjs`、`check-version.mjs`、`set-android-version.mjs`、`notes.mjs`、`publish-mpv-sources.mjs`；新增 `tests/release-scripts.test.ts`。

- `checksums.mjs`：`checksumLines(dir)` 返回「`<sha256>  <文件名>`」行（按文件名排序，不含 `sha256sum.txt` 自身）；CLI 写出 `sha256sum.txt`。
- `check-version.mjs`：`assertVersion(tag, pkgVersion)`，标签必须是 `vX.Y.Z` 且与 `package.json` 一致。
- `set-android-version.mjs`：把版本写入 `android/version.properties`，范围检查沿用 `android-release.mjs`。
- `notes.mjs`：由版本与文件名列表生成发布说明（各端对应文件、校验方法、mpv 源码链接）。
- `publish-mpv-sources.mjs`：若 `mpv-sources-<id>` 发布不存在，创建并上传 `dist/*-sources.tar` 与校验文件；已存在则跳过。
- 验证：`pnpm vitest run tests/release-scripts.test.ts`。

## 任务 5：工作流 `.github/workflows/release.yml`

- 触发：`push` 标签 `v*`；`workflow_dispatch`（输入 `version`，只演练：不创建发布、不推镜像，产物作为 Actions 附件）。
- `prepare`：算版本；`check-version.mjs`。
- `windows`（windows-latest）：`pnpm install --frozen-lockfile` → `pnpm fetch:mpv` → `pnpm build:nocheck` → `electron-builder --win --publish never` → 上传 `dist/yingbox-setup-*.exe`；标签触发时再运行 `publish-mpv-sources.mjs`。
- `mac`（macos-latest）：`pnpm build:nocheck` → `electron-builder --mac --publish never` → 上传 `dist/*.dmg`。
- `android`（ubuntu-latest，Java 21，Node 22）：`set-android-version.mjs` → 由 Secrets 写 `android/keystore.properties` → `node scripts/android-release.mjs`（不带 `--publish`，沿用其中的签名指纹与版本核对）→ 上传两个 apk。
- `nas`（ubuntu-latest）：QEMU + buildx；标签触发时登录 `ghcr.io` 并推 `ghcr.io/acefake/yingbox-nas:X.Y.Z-nas.1`（`linux/amd64,linux/arm64`）；演练只构建不推。`stable` 仍由本机 `scripts/nas-release.mjs` 在验证后指向。
- `release`：下载附件，生成 `sha256sum.txt`；演练到此为止并上传附件；标签触发时先建草稿发布，上传、逐个核对大小与 digest，通过后 `gh release edit --draft=false --latest`。
- 权限：默认 `contents: read`；`nas` 需 `packages: write`；`release` 与 mpv 源码发布需 `contents: write`。
- Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（名称以 `android/keystore.properties` 实际字段为准，写入前核对）。
- 验证：`actionlint`（若可用）；分支上 `workflow_dispatch` 演练。

## 任务 6：文档与 ADR

- 新增 `docs/adr/0038-unified-github-release.md`，取代 ADR-0037 决策 1、2、4；ADR-0037 状态改为「部分被 0038 取代」。
- `AGENTS.md` ADR 索引加 0038；`docs/release-licenses.md` 的下载位置改为 mpv 源码固定发布。
- 验证：`pnpm vitest run tests/dev-gates`。

## 不在本计划内

- 旧发布清理：执行前逐项向用户确认再删。
- macOS 签名公证与自动更新。
- 修复 `main` 上现有的 13 个失败测试与类型错误。
