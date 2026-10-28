# 第三方软件声明

影盒自有代码采用根目录 `LICENSE` 中的 MIT 许可证。下列第三方软件、模型和资源分别遵循各自的授权，主项目的 MIT 许可证不替代上游条款。

| 组件                     | 使用方式                                     | 授权文件与来源                                                                                                                                                                             |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| elevengo m115            | `src/main/pan115/m115.ts` 的 TypeScript 移植 | MIT，Copyright (c) 2022 Tomo Kunagisa；见 `licenses/elevengo-MIT.txt`；https://github.com/deadblue/elevengo                                                                                |
| NassAV                   | 下载模块中保留的移植来源授权                 | MIT；见 `licenses/NassAV-MIT.txt` 和 `src/engine/download/LICENSE-NASSAV`；https://github.com/satoing/NassAV                                                                               |
| mpv / MPlayer / mplayer2 | Windows 独立播放器进程，通过 JSON IPC 控制   | 见 `licenses/mpv-Copyright.txt`、`licenses/mpv-GPL-2.0.txt` 和下述发行说明；https://github.com/mpv-player/mpv                                                                              |
| FFmpeg / libplacebo      | Windows mpv 构建中的媒体处理依赖             | 见 `licenses/ffmpeg-LICENSE.md`、`licenses/ffmpeg-COPYING.GPLv3.txt`、`licenses/libplacebo-LGPL-2.1.txt`；具体组合以该构建及各上游文件为准                                                 |
| ONNX Runtime             | 本机模型推理                                 | MIT；见 `licenses/onnxruntime-MIT.txt` 与 `licenses/onnxruntime-ThirdPartyNotices.txt`；https://github.com/microsoft/onnxruntime/tree/v1.23.2                                              |
| Chinese-CLIP             | 按画面搜索时下载的模型与 tokenizer           | 原项目 MIT，见 `licenses/chinese-clip-MIT.txt`；模型来源 https://huggingface.co/Xenova/chinese-clip-vit-base-patch16 ，原模型 https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16 |
| Electron / Chromium      | 桌面运行时                                   | 打包时原样附上该 Electron 版本的 `LICENSE` 和 `LICENSES.chromium.html`                                                                                                                     |
| npm 生产依赖             | 应用与引擎运行                               | 打包时生成 `npm-manifest.json` 与 `npm-NOTICES.txt`，包含实际安装版本、直接和间接生产依赖的许可原文                                                                                        |

## 发行包中的位置

桌面发行包在 `resources/LICENSE` 保存主项目的 MIT 许可证，在 `resources/third-party/` 保存本文、npm 依赖清单及 Electron/Chromium 授权，在 `resources/licenses/` 保存仓库中的授权文本。

`electron-builder` 的 `beforePack` 钩子自动运行 `scripts/third-party-notices.mjs`。缺失某个生产依赖的许可证时构建失败，需要按该依赖的具体版本补充授权；不会把未知授权自动当成 MIT。

运行 `node scripts/third-party-notices.mjs` 可在本地重新生成并检查。`licenses/sources.json` 记录补充许可原文的获取地址。`lazy-val` 上游只在包元数据声明 MIT，补充文件明确记录该情况，并附标准 MIT 条款和作者元数据。

## mpv 发行说明

Windows 分发 MSYS2 UCRT64 的 mpv `0.41.0-10` 及其运行库。安装包的 `resources/third-party/mpv/` 保存完整对应源码集合、构建配方与记录、文件哈希、原生组件许可清单和许可原文；包内声明另在 `resources/mpv/share/licenses/`。FFmpeg 的这份构建启用了 GPL / version3。

锁定版本和对应关系见 `src/shared/mpv-distribution.json`，源码构建及分发要求见 `docs/release-licenses.md`。mpv 通过独立进程和 JSON IPC 使用，影盒自有代码采用 MIT。构建钩子校验这些材料，缺失时停止 Windows 打包。

## 外部服务与内容

TMDB、豆瓣、CMS、插件站点、海报、剧照及视频内容不因本项目的软件许可而获得再分发授权。用户填写的服务令牌、账号数据和私有媒体不属于发行内容。
