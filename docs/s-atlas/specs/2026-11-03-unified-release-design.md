# 统一发布：一个版本一个发布，所有端安装包放在一起

- 日期：2026-11-03
- 状态：待审阅

## 目标

推一个 `vX.Y.Z` 标签，GitHub Actions 自动构建所有端，在同一个 Release 里只放各端安装包和一个 `sha256sum.txt`（参考 Ollama 的发布页）。

## 范围

| 端      | 产物                                                 | 去处                  |
| ------- | ---------------------------------------------------- | --------------------- |
| Windows | `yingbox-setup-X.Y.Z.exe`                            | 发布页                |
| macOS   | `yingbox-X.Y.Z.dmg`（无签名公证）                    | 发布页                |
| 安卓    | `yingbox-android-X.Y.Z-arm64-v8a.apk`、`-x86_64.apk` | 发布页                |
| NAS     | 双架构 Docker 镜像                                   | `ghcr.io`，不进发布页 |
| 校验    | `sha256sum.txt`（覆盖发布页上的全部安装包）          | 发布页                |

发布页不放：`latest.yml`、`*.blockmap`、mpv 源码包、安卓 SHA-256 清单（并入 `sha256sum.txt`）。GitHub 自动附带的 `Source code (zip / tar.gz)` 无法去掉。

## 决策

1. **触发**：推送标签 `v*`。另提供 `workflow_dispatch`，只出草稿，用于演练。
2. **版本统一**：桌面、安卓共用标签里的版本号。安卓 `versionName` 取自标签，`versionCode = x*10000+y*100+z` 规则不变。`package.json` 版本必须与标签一致，不一致则失败。
3. **构建任务**：四个并行任务（windows-latest、macos-latest、安卓、NAS 镜像）。Windows 任务先 `fetch:mpv`。安卓的 keystore 与口令存 GitHub Secrets，缺少时失败，不退回调试签名。
4. **发布顺序**：先建草稿 Release；全部任务成功后统一上传、生成 `sha256sum.txt`，再公开。任一端失败则保持草稿，更新器看不到半成品。
5. **关闭差分包**：`electron-builder` 设 `nsis.differentialPackage: false`，不再生成 blockmap；不再用 `publish` 自动上传，产物由发布任务统一上传。
6. **Windows 更新器改自实现**：不再依赖 `electron-updater` 与 `latest.yml`。查询 Latest 发布，找到 `yingbox-setup-*.exe` 与 `sha256sum.txt`，下载并校验 SHA-256 后再启动安装包。校验失败不安装。
7. **安卓更新器改读统一发布**：从 Latest 发布找 `yingbox-android-*-<abi>.apk`，用 `sha256sum.txt` 校验。不再依赖 `android-v` 标签和 Pre-release 分类。
8. **mpv 源码**：从发布页移除。安装包内许可说明与 README 写明上游固定版本的源码地址。合规风险由项目所有者确认接受。
9. **旧发布**：`v1.0.1`、`android-v0.1.0`、`nas-v1.0.1-nas.1` 等旧发布与标签清理掉。删除前再逐项确认，因为已安装用户的更新检查会暂时失效。
10. **质量门槛**：工作流只做构建，不跑完整测试，因为 `main` 上现有 13 个测试失败和 1 个类型错误。修好后再加 typecheck、lint、test 作为发布前检查。
11. **ADR**：新增 ADR 取代 ADR-0037 的决策 1、2、4（本机构建、安卓独立标签、安卓按分类取包）；同时取代「不增加 GitHub Actions」的约定。

## 风险与未决

- macOS 无签名公证，用户首次打开会被系统拦截；没有 mac 自动更新。
- Windows 更新器是自写的，必须补测试：查询失败、校验失败、下载中断、版本比较。
- 删除旧发布后，仍装着旧版本的用户在更新前检查会失败。
- mpv 源码不随发布提供，合规程度弱于现状。
- 自写 Windows 更新器的安装方式（静默 `/S` 还是交互）沿用现有 electron-updater 的行为，计划阶段确认。

## 验证

1. 在分支上用 `workflow_dispatch` 演练，只出草稿；检查各端产物齐全、命名正确、`sha256sum.txt` 与产物一致。
2. 用草稿里的真实安装包本机验证 Windows 与安卓的更新检查。
3. 以上都通过，再打真实标签。
