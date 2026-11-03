# 安卓播放内核设计（子项目 A）

日期：2026-11-03
状态：设计已确认

## 背景与目标

安卓端目标是做到 Infuse 级的播放能力。整体拆为四个子项目，本文只覆盖 A：

| #   | 子项目            | 说明                                                   |
| --- | ----------------- | ------------------------------------------------------ |
| A   | 播放内核          | 能力探测、解码兜底、音频直通、帧率匹配、轨道模型、统计 |
| B1  | 连 NAS 版影盒     | 通过 HTTP 使用 `/media/files/<id>` 与字幕路由          |
| B2  | WebDAV / SMB 直连 | 内嵌服务直接挂载 NAS 共享目录                          |
| C   | 播放器界面        | Compose 自绘控制层、手势、遥控、字幕样式               |
| D   | 兜底重建          | P5 等解不了的片源由服务端重建（ADR-0017）              |

顺序：A → B1 → C → B2 → D。A 不依赖文件来源。

现状：`PlayerScreen.kt` 直接构造 `ExoPlayer`（media3 1.11.1），使用默认 `PlayerView`；没有 HDR / DV 处理、没有扩展解码器、没有轨道选择。

## 范围

做：能力探测、播放器工厂、视频信息解析、轨道模型、统计数据、`PlayerScreen` 改用以上模块。
不做：新的控制层界面（C）、文件来源（B）、服务端重建（D）。

## 结构

新建包 `com.yingbox.android.playback.engine`：

- `Capabilities`：启动时探测并缓存一次。
  - 硬件解码器：HEVC、AV1、DV 各 profile（`MediaCodecList`）。
  - 屏幕 HDR：DV、HDR10、HDR10+、HLG（`Display.HdrCapabilities`）。
  - 音频直通：当前输出设备可直通的格式（`AudioCapabilities`）。
- `PlayerFactory`：创建 `ExoPlayer`。`RenderersFactory` 使用 `EXTENSION_RENDERER_MODE_ON`（平台解码器优先，扩展解码器兜底），开启 `setEnableDecoderFallback(true)`；视频固定 `SurfaceView`；帧率切换策略仅无缝时执行。
- `VideoInfo`：从轨道 `Format` 解析分辨率、HDR 类型、DV profile（编码串如 `dvhe.08.06`）、实际解码器名。纯函数。
- `TrackModel`：把音轨、字幕轨、章节整理成界面可直接展示的选项（语言、编码、声道、是否外挂）。纯函数。
- `Stats`：由 `AnalyticsListener` 汇总码率、丢帧、缓冲时长。
- `PlayDecision`：决策表（见下），输入 `Capabilities` 与 `VideoInfo`，输出播放方式与提示文案。纯函数。

`PlayerScreen.kt` 只保留界面、进度上报与换源逻辑，播放器的构造与轨道信息全部走上面的模块。

## 决策表

| 情况                                 | 处理                                           |
| ------------------------------------ | ---------------------------------------------- |
| DV P8 且设备有 DV 解码器             | 走 DV                                          |
| DV P8 / P7 且设备无 DV 解码器        | 走 HEVC 基础层，徽标显示 HDR10 或 SDR          |
| DV P5 且设备无 DV 解码器             | 标记"颜色可能不正确"（D 完成后改为服务端重建） |
| 音频格式设备不支持（DTS、TrueHD 等） | ffmpeg 软解                                    |
| 屏幕与 HDMI 功放支持                 | Atmos、TrueHD、DTS-HD 直通                     |
| AV1 无硬解                           | dav1d 软解                                     |

软解仅作兜底，不作默认。

## 错误处理

解码初始化失败：先自动换解码器，再换软解，仍失败才报错。错误码映射为中文并说明原因，例如"本设备不支持 DTS，已改用软解"。

## 测试

- JVM 单元测试：编码串解析、`PlayDecision` 决策表、`TrackModel` 命名。
- 真机清单：P8、P5、P7、Atmos、DTS、AV1 各一个样片，在目标设备上逐项过。

## 风险

- ffmpeg 与 dav1d 扩展需用 NDK 自行编译，APK 会增大。仅打 arm64，并在实现第一步验证构建可行；若不可行，音频软解改用社区预编译包，AV1 软解后置。
- 低端电视盒子软解 4K HEVC / AV1 会卡，因此软解只做兜底。
