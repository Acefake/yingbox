# ADR-0038 统一发布：一个版本一个 GitHub Release

- 日期：2026-11-03
- 状态：已采纳
- 取代：ADR-0037 的决策 1（本机构建发布、不增加 GitHub Actions）、决策 2（`android-v` 标签、Pre-release 分类）、决策 4 中按标签和分类取包的部分

## 背景

桌面、安卓、NAS 各自用一套标签和发布方式：桌面是 `v*` 的 Latest，安卓是 `android-v*` 的 Pre-release，NAS 是 `nas-v*`。用户要在一个页面找到所有端的安装包，发布页只放安装包。

## 决策

1. **触发与构建**：推送标签 `vX.Y.Z`，由 `.github/workflows/release.yml` 并行构建 Windows、macOS、安卓和 NAS 镜像。手动运行只演练，不建发布、不推镜像。
2. **版本统一**：所有端共用标签里的版本号，标签必须与 `package.json` 一致。安卓 `versionName` 取自标签，`versionCode = x*10000+y*100+z` 不变。
3. **发布页内容**：只放 `yingbox-setup-X.Y.Z.exe`、`yingbox-X.Y.Z-<arch>.dmg`、`yingbox-android-X.Y.Z-<abi>.apk` 和 `sha256sum.txt`。NAS 镜像推到 `ghcr.io/acefake/yingbox-nas:X.Y.Z-nas.1`，`stable` 仍由 `scripts/nas-release.mjs` 在验证后指向（ADR-0025）。
4. **草稿先行**：先建草稿，上传后逐个核对远端大小与摘要，一致才公开并设为 Latest；失败保留草稿。
5. **更新器**：桌面更新器 `src/main/updater/desktop-updater.ts` 取代 `electron-updater`，读发布列表，下载时校验资产 `digest`（GitHub 服务端计算的 SHA-256），一致才启动安装包。安卓更新器读同一个发布里的 `yingbox-android-*.apk`，同样校验 `digest`。规则在 `src/shared/release/pick.ts`。发布页不再放 `latest.yml` 和 blockmap。
6. **mpv 源码**：发布页不放源码包。对应源码由 MSYS2 官方源码仓库提供，按 `src/shared/mpv-distribution.json` 中的文件名与 SHA-256 取得，说明在安装包内的 `DOWNLOAD.md` 和 `docs/release-licenses.md`。项目所有者确认接受这一做法，合规程度弱于随发布并列提供源码。
7. **macOS**：无签名公证，不提供应用内更新。

## 后果

- 旧的 `electron-updater` 客户端找不到 `latest.yml`，不会再更新，需要手动安装一次新版。安卓 `android-v` 标签下的旧版本同理。
- 安卓发布签名要以 GitHub Secrets（`ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`）保存；密钥仍须在可信位置另行备份。
- Windows 更新器是自有实现，查询、下载、校验、安装的失败路径由 `tests/desktop-updater.test.ts` 覆盖。
- 发布流程只构建，不跑完整测试；测试门槛随主干测试全部通过后再加入。
- GitHub 自动附带的 `Source code (zip / tar.gz)` 无法从发布页移除。

## 否决方案

- 各端分别发布：用户要在多个发布里找安装包。
- 保留 `latest.yml` 与 blockmap：发布页多出非安装包文件，且差分更新对 197 MB 的安装包收益有限。
- 把 mpv 源码包放进每个版本发布，或放进单独的固定发布：每次多传 1.19 GB，或发布列表里多出非安装包条目。
