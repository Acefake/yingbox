# ADR-0043 安卓按实际格式核对解码能力，并传递单文件 DV 探测

- 日期：2026-11-04
- 状态：已采纳
- 部分取代：ADR-0039 的 Profile 决策、ADR-0042 的兼容层信息来源与原生播放候选判断

## 背景

单看 DV Profile 不能判断设备能否处理当前片源的 level、尺寸与帧率。NAS 已有每个视频文件的动态范围探测，但安卓只保留版本按钮上的文字标签，没有将兼容号传到播放器。

## 决策

1. 视频输入格式变化时，使用当前依赖 Media3 1.11.1 的 `MediaCodecUtil.getDecoderInfosSoftMatch` 与 `MediaCodecInfo.isFormatSupported(context, format)` 查询原始格式和兼容 MIME 路径。DV 原生候选只接受声明支持已知格式的硬件解码器，普通视频允许系统提供的软件解码器。
2. 查询失败、缺少 MIME 或尺寸、DRM 格式保留未知，不将异常记成明确不支持。结果表示设备声明，不是实际显示模式或性能保证。不重复实现 Media3 的 profile/level/尺寸检查。
3. 片库解析将 `files[].video` 按真实文件 ID 存入版本，电影选版本和剧集队列都携带对应数据。播放前核对条目文件 ID，换集、换源时重置。不会为了补信息新增开播网络请求。
4. 文件探测对应第一条正片视频流。只有轨道集合中恰有一条视频轨，且当前输入和文件探测的 DV Profile 一致，才使用该兼容号；多视频轨、缺失 Profile 或 Profile 不同均保留未知。
5. 兼容号 1/6 为 HDR10、2 为 SDR、4 为 HLG，其余不猜。对应兼容解码器和显示能力均满足时，只提示“兼容层候选，实际回退输出尚未确认”。P5 或明确无兼容层且无法原生解码时提示颜色风险。
6. 不强改 codec/MIME，不新增转码，不据此声明 Media3 已选择基础层，更不声明屏幕已进入对应模式。实际解码与回退仍由 Media3 完成。

## 后果

- 在线播放没有 NAS 探测时仍可查询当前格式的解码支持，兼容号保持未知。
- 文件探测是 NAS 缓存，原文件被替换后需重新探测。本批不以缓存结果强制转码或拦截播放。
- HDR10+ 动态元数据识别、在线容器 DV 配置提取和实际输出验证仍需后续开发与真机验收。
- Media3 的 DV 兼容路径会推导基础层 Profile，并将该层 level 设为 0 后检查尺寸和帧率。本批没有读取或验证基础层真实 level，不能把兼容候选描述成完整的基础层规格验收。
- 单测覆盖已知兼容号、未知和冲突数据、多轨禁用探测、版本隔离。平台真实解码器查询只能在设备上验证。

## 否决方案

- 仅根据 Profile 列表判断原生支持：无法覆盖当前 level、尺寸和帧率。
- 将电影或剧集的最高规格套到所有版本：会把其他文件的兼容号带入当前播放。
- 从兼容候选直接宣称实际输出成功：缺少最终显示证据。

## 官方与本地依赖依据

- [MediaCodecUtil](https://developer.android.com/reference/androidx/media3/exoplayer/mediacodec/MediaCodecUtil)
- [MediaCodecInfo](https://developer.android.com/reference/androidx/media3/exoplayer/mediacodec/MediaCodecInfo)
- 已核对本机 Gradle 缓存中 `media3-exoplayer-1.11.1-sources.jar`：兼容 MIME 由 Media3 规则提供，`isFormatSupported` 检查已知 codec profile/level 与视频尺寸/帧率。
