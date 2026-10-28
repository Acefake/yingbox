# 第三方组件发行记录

## mpv Windows 20261015

- 压缩包：`mpv-x86_64-20261015-git-492bae0768.7z`
- 下载：https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261015/mpv-x86_64-20261015-git-492bae0768.7z
- SHA-256：`f9becefe40e2a29d2ce5f3ab231ff094f9cf3e4038ff014cfe4a0c09ad90e79e`
- mpv 源码：https://github.com/mpv-player/mpv/tree/492bae0768
- FFmpeg 源码：https://github.com/FFmpeg/FFmpeg/tree/ee8cbd7db
- libplacebo 基础版本：https://github.com/haasn/libplacebo/tree/804dc71
- 构建配方：https://github.com/shinchiro/mpv-winbuild-cmake/tree/1f8d2e76255abc48f0456d9be99b4cab9c6566e6
- 构建记录：https://github.com/shinchiro/mpv-winbuild-cmake/actions/runs/38657432408
- 上游许可：`licenses/mpv-Copyright.txt`、`licenses/mpv-GPL-2.0.txt`；关联媒体库许可另见 `THIRD_PARTY_NOTICES.md`。

本地 `mpv --version` 确认：mpv `v0.41.0-1175-g492bae076`，FFmpeg `N-127552-gee8cbd7db`，libplacebo `v7.360.0-162-g804dc71-dirty`。`dirty` 表示仅凭基础提交无法还原全部构建修改。

上游二进制压缩包不含独立许可证文件。影盒在发行包外置附上许可全文，且下载脚本保留压缩包中原有文档。

## 二进制发布前仍须确认的源码材料

上述链接是已确认的来源记录，不声称已构成整个 Windows 二进制的完整对应源码。实际分发该二进制前，需要从构建提供者取得并归档该构建所有相关组件的对应源码、补丁和构建脚本，并与安装包在同一发行页面提供；尤其要核对 libplacebo 的构建修改、静态链接库和 `d3dcompiler_43.dll` 的分发条款。仅附 GPL 文本或链接到浮动的 master 分支不代替这些材料。

当前未提供书面源码要约，也未确认整个 mpv 构建的完整源码包。该项完成前不能将这份声明描述为二进制发行合规验收完成。

## npm 与 Electron

`beforePack` 收集实际安装的生产依赖授权，包含 ONNX Runtime 的第三方声明；Electron 的 Chromium 声明从安装的运行时复制。生成结果在 `resources/third-party/`，应随安装包保留。

## 历史令牌清理

TMDB 凭据通过精确内容替换从所有可写远端分支和标签的可达 Git 历史中移除。凭据本身仍需由账号持有人在 TMDB 撤销或轮换。协作者应重新克隆，避免旧历史被再次合并推回；GitHub 的旧提交缓存、PR 引用和他人的克隆不由普通强制推送清除。
