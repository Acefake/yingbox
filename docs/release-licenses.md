# 第三方组件发行记录

## Windows mpv

影盒分发 MSYS2 UCRT64 的 mpv `0.41.0-10`，通过独立进程与 JSON IPC 使用。FFmpeg 为 `9.0.2-2`，libplacebo 为 `7.387.0-1`。影盒自有代码继续采用 MIT；这些组件及其组合遵循各自的 GPL、LGPL 和其他条款，见随包许可原文。FFmpeg 的这份构建启用了 GPL 和 version3。

可核验记录在 [`src/shared/mpv-distribution.json`](../src/shared/mpv-distribution.json)：包含每个二进制包、实际分发文件、完整源包的 SHA-256，以及对应构建配方的 SHA-256。下载入口为 [MSYS2 官方仓库](https://repo.msys2.org/mingw/)，[官方文档](https://www.msys2.org/dev/mirrors/)说明该仓库同时保存匹配的二进制包和源包。

mpv 包：`mingw-w64-ucrt-x86_64-mpv-0.41.0-10-any.pkg.tar.zst`，SHA-256 为 `337340960cb05d9b27d5d897cdbbe38cba5605a860aae95f94bea18522507e88`。安装路径为 `resources/mpv/bin/mpv.exe`。保留运行所需 DLL、包内许可及字体配置；Vulkan 和 shaderc 的动态加载库也纳入清单。Windows 自带 DLL 由系统提供，不分发 `d3dcompiler_43.dll`。

## 独立下载的对应源码

Windows 构建在 `dist/` 生成安装包、独立源码包、SHA-256 校验文件和 `MPV-SOURCE-DOWNLOAD.md`。下载页面须并列提供安装包和对应源码，源码无需额外付费。这采用 [GPLv3 第 6(d) 节](https://www.gnu.org/licenses/gpl-3.0.html#section6)规定的网络下载方式；接收者可自行选择是否下载源码。

完整源码包 `*-sources.tar` 包含未经修改的 MSYS2 `.src.tar.zst` 源包、上游源码、补丁、`PKGBUILD` 和 `.SRCINFO`，以及二进制 `.BUILDINFO`、`.PKGINFO`、分发清单、许可与构建说明。包括 shaderc / glslang / SPIR-V 等静态构建输入。

Windows 安装后的 `resources/third-party/mpv/` 保留：

- `DOWNLOAD.md`：对应源码文件名、校验值和下载位置说明。
- `manifest.json`：版本、原始下载地址、SHA-256、实际安装文件和源包对应关系。
- `NOTICES.md`、`licenses/`：组件许可清单及许可原文。包自带的声明另在 `resources/mpv/share/licenses/`。
- `BUILDING.md`：本说明；`source-bundle.json` 记录源码集合本身的 SHA-256。

发行时必须同时提供安装包、匹配的源码包、校验文件和下载说明，并在安装包下载入口旁放置源码链接，保持同等可访问性；不能只发布安装包或仅指向上游首页。安装器不携带大体积源码归档，但保留运行文件、许可和获取说明。这里不依赖书面源码要约。

`pnpm fetch:mpv` 准备播放器与源码材料，并导出独立源码下载文件。`electron-builder` 的 `beforePack` 再次验证；二进制、源包或构建配方不匹配时构建失败。`output/mpv-cache/` 只作为本机缓存，不能代替交付的源码下载文件。更新播放器时须同步更新锁文件、源包及验证记录。

### 查看、修改和构建源码

解开 `*-sources.tar`，再解开需要修改的组件源包。源包内 `PKGBUILD` 是该组件的构建与安装脚本，`.SRCINFO` 记录依赖；`binary-metadata/*.BUILDINFO` 保存发布二进制的编译器、构建环境及依赖版本。源包 `PKGBUILD` 的 SHA-256 已与该二进制构建记录逐一核对。

使用 Windows 的 [MSYS2 UCRT64 环境](https://www.msys2.org/docs/environments/)，按照 [MSYS2 构建文档](https://www.msys2.org/wiki/Creating-Packages/)安装构建工具与配方列出的依赖。进入解开的配方目录执行：

```sh
MINGW_ARCH=ucrt64 makepkg-mingw --syncdeps --cleanbuild
```

先构建需要修改的依赖并用 `pacman -U` 安装所生成的包，再构建上层组件。需要恢复发行环境时，按 `.BUILDINFO` 中记录的版本准备依赖；直接同步当前仓库可能使用较新的工具链。这些材料提供可修改源码与构建步骤，不保证生成的二进制逐字节相同。普通操作系统组件与构建工具从 MSYS2 / Windows 环境取得。

影盒没有修改这些原生组件的源代码；运行库从锁定的上游包中选择并原样提取。LGPL 动态库保持独立文件，可用兼容版本替换。影盒 MIT 许可不限制为调试这些库的修改而进行的逆向工程。

## npm 与 Electron

`beforePack` 收集实际安装的生产依赖授权，包含 ONNX Runtime 的第三方声明；Electron 的 Chromium 声明从安装的运行时复制。生成结果在 `resources/third-party/`，随安装包保留。macOS / Linux 使用用户自行安装的 mpv，不附带这套 Windows 运行库与源码集合。

## 历史令牌清理

TMDB 凭据通过精确内容替换从所有可写远端分支和标签的可达 Git 历史中移除。凭据本身仍需由账号持有人在 TMDB 撤销或轮换。协作者应重新克隆，避免旧历史被再次合并推回；GitHub 的旧提交缓存、PR 引用和他人的克隆不由普通强制推送清除。
