# ADR-0039 安卓播放内核：能力探测、决策表、解码器兜底

- 日期：2026-11-03
- 状态：已采纳
- 相关：ADR-0028（安卓端方案）、ADR-0032（选源与播放）、ADR-0017（桌面杜比视界重建）

## 背景

安卓播放器此前直接构造 ExoPlayer，没有杜比视界、HDR 处理，没有扩展解码器，也没有轨道模型。NAS 片源里的 DV（P5、P7、P8）、DTS、TrueHD 在不同设备上表现不一。

## 决策

1. **能力探测，不堆软解。** `playback/engine` 在进入播放页时探测一次：硬件 DV 解码器支持的 profile、屏幕 HDR、AV1 硬解、音频直通；进程内缓存。
2. **一个决策表。** `planVideo` 只看（视频 DV profile，设备能力）：设备有对应 DV 解码器 → 原样；P7 / P8 无解码器 → HEVC 基础层，按屏幕能力显示 HDR10 或 SDR；P5 无解码器 → 提示颜色可能不正确（子项目 D 再做服务端重建，复用 ADR-0017 的思路）。
3. **解码器策略。** 平台解码器优先（`EXTENSION_RENDERER_MODE_ON`），同一渲染器内初始化失败自动换下一个解码器，扩展解码器兜底；音频直通交给 ExoPlayer 的音频输出按设备和 HDMI 能力自动选择。
4. **音频软解用 ffmpeg 扩展**：media3 官方不发布到 Maven，用社区预编译包 `org.jellyfin.media3:media3-ffmpeg-decoder`（1.9.0+1，对应 media3 1.9.0，本项目用 1.11.1）。2026-11-03 在 Android 16 x86_64 模拟器上验证：扩展加载成功（`FfmpegLibrary.isAvailable()` 与 `supportsFormat("audio/vnd.dts")` 均为 true），普通 H.264 片源播放不受影响；DTS 实际解码有声、DV 与直通要在真机上验证。`PlayerFactory` 在扩展加载失败（`RuntimeException` / `LinkageError`）时退回不带扩展的播放器，不让所有片源受影响。
5. **轨道、统计、错误中文映射**各自一个纯函数或薄适配，界面（子项目 C）直接消费。

## 后果

- 决策只看编码串里的 DV profile，**不区分 P8 的兼容 ID**（编码串里没有）：P8.2（SDR 基础层）、P8.4（HLG 基础层）也会提示成「按 HDR10 / SDR 播放」；P10（AV1）无兼容层时同样走基础层提示。要精确需要读容器里的 `dvcC` 配置，留给后续。
- 决策也不核对实际解码路径（`StatsSnapshot.videoDecoder` 已记录真实解码器名，C 的统计浮层可以展示，便于人工核对）。
- 能力在进入播放页时探测一次并缓存到进程结束：HDMI 热插拔、换接功放后不更新。
- AV1 软解（dav1d）没有 Maven 包，需自编 NDK，本期不做；无 AV1 硬解的设备放不了 AV1。
- 软解 4K 在低端盒子上会卡，所以只对音频软解。
- 「先换解码器，再换软解」只在同一渲染器内成立：MediaCodec 渲染器声称能处理某格式但初始化失败时，不会再退到 ffmpeg，而是报 `DECODER_INIT_FAILED`。
- ffmpeg 为 LGPL，随 APK 的第三方声明需要包含它（发布前补进 `android/README.md` 的第三方声明）。社区包带 4 个 ABI，debug 包约增大数 MB；发布包按 ABI 拆分后只含 arm64-v8a 与 x86_64。
- 升级 media3 小版本时要重新验证 ffmpeg 扩展，因为它继承了 media3 的 `@UnstableApi` 类。

## 否决方案

- **视频软解兜底 DV**：性能不够，且没有 DV 元数据处理，结果还是偏色。
- **自己实现音频直通开关**：ExoPlayer 已按 HDMI 能力自动选择，再加开关只会和设备能力冲突。
