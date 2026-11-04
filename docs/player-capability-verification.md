# 播放能力交付与验证记录

日期：2026-11-04。开发分支：`feat/hdr-playback-diagnostics`。代码未提交、未发布。用户已要求暂不进行真机验收。

## 已实现

| 客户端               | 代码能力                                                                                                           | 验证边界                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 安卓手机、Android TV | 共用 HDR/DV 输入识别、当前设备能力刷新、实际格式解码器查询、兼容基础层候选判断、诊断查看与安全复制、右上角片源标识 | JVM 测试和 Debug APK 构建通过；没有确认任一具体设备的 HDR/DV 输出     |
| 桌面内置播放器       | 原文件探测随已加载文件绑定右上角标识；DV 原片与重建后的 HLS 输入分开显示                                           | 保留现有 DV 重建路线；没有把探测成功当成屏幕输出成功                  |
| Web、NAS 网页        | 同一播放器标识，读取实际视频尺寸、HLS 当前档位与所选音轨元数据                                                     | 浏览器未提供的格式不显示；不根据片名或 EAC3 猜测 Atmos                |
| 桌面 mpv             | 原始解码尺寸、HDR/DV 和所选音轨的右上角 OSD；VSR 能力筛选、命名滤镜管理、换片保护、失败清理                        | 已在本机 D3D11 输出截图确认 OSD；本机 AMD GPU 无法验证 NVIDIA AI 画质 |

标识中的“片源”表示输入规格。原片为 DV、重建流为 HDR10 时同时标明，不能据此认定显示器已进入 DV 模式。放大后的尺寸不改变原片分辨率标识。没有可靠动态元数据时不显示 HDR10+；没有可靠对象音频元数据时不显示 Atmos。

mpv 的开播、鼠标活动和暂停可以唤出 OSD；播放中四秒后消隐，暂停时保留。OSD 通过 mpv 自身渲染，不覆盖外部 Electron 窗口。

## 超分研究结论

### 桌面 NVIDIA 路径已接入，实际 AI 效果待硬件确认

仅对 Windows、NVIDIA 设备、当前 D3D11 硬解、低于 1080p 且确需放大的常规 SDR 尝试配置。HDR、DV、广色域和未知视频轨保持旁路，包括带 SDR 基础层的 DV 8.2。滤镜成功挂载只显示“已配置，AI 效果未验证”。

影盒只管理自己的 `@yingbox-vsr` 标签。换片前同步保护，配置失败停止自动重试；不修改其他用户滤镜。具体决策见 [ADR-0044](adr/0044-mpv-vsr-filter-lifecycle.md)。

### 安卓与电视：存在 GPU 缩放接口，尚未接入产品

Media3 1.11.1 提供 `LanczosResample.scaleToFit`，属于普通高质量缩放。`setVideoEffects` 需要同版本 `media3-effect`，在首次 `prepare` 前初始化；不支持 DRM，也不等于 AI 超分。

源码中，非空的 `videoEffects` 字段会初始化视频处理图。将效果列表设为空，不能据此断言已经恢复原始解码直出。现有共用播放器不能以“清空效果列表”作为 HDR/DV 安全退出措施，因此本分支没有增加一个未经验证的增强开关。

后续实现必须隔离原生与增强播放器生命周期：仅对已确认 SDR、非 DRM、非自适应的受控文件启动增强播放器；关闭、换片、处理失败或遇到 HDR/DV 时，销毁增强图并恢复原生播放器，转移进度、音轨、字幕和播放状态。然后再测帧延迟、掉帧和温控。未通过这些条件前，不接入 AI 模型。

依据：[ExoPlayer 视频效果限制](<https://developer.android.com/reference/androidx/media3/exoplayer/ExoPlayer#setVideoEffects(java.util.List)>)、[LanczosResample](https://developer.android.com/reference/androidx/media3/effect/LanczosResample)、[Media3 1.11.1 视频渲染器源码](https://github.com/androidx/media/blob/1.11.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/MediaCodecVideoRenderer.java)。

### Web、Electron 内置播放器与 NAS：保持直放

本分支没有加入浏览器 AI 模型、GPU 帧处理或服务端增强会话。浏览器增强还需验证帧访问权限、输入色彩、DRM、字幕、全屏、画中画和失败后的无缝退出；API 存在不代表可以持续实时处理。NAS 转换还需要独立的 GPU/编码器探测、鉴权、资源限额与会话回收。

因此当前交付不能称为“全部端 AI 超分已完成”。安卓/Web/NAS 增强仍是有退出条件的研究范围；原生 HDR/DV 路线不受这些未验证原型影响。

## 自动化与本机验证

- 安卓：62 项 JVM 测试通过；`:app:assembleDebug` 成功。APK：`android/app/build/outputs/apk/debug/app-debug.apk`。本次未改动的 `PlayerFullscreen.kt` 仍有既有 `WrongConstant` Lint 问题。
- 播放器相关最终 9 个测试文件、87 项测试通过，覆盖队列、销毁、快捷键、DV 回退、源标识及 mpv 保护。
- Node/Web 源码类型检查通过；测试类型检查仍有三处既有错误：缺失 `continue-rules` 导入，以及测试夹具缺失 `logo` / `hasDirect`。
- 桌面和 Web 生产构建通过；样式令牌与导入大小写检查通过。
- 完整测试曾执行：471 文件中 455 通过、15 失败、1 跳过；本任务引入的测试桩与文件长度失败已经修复，并在上述针对测试中通过。剩余失败含并发更新器 ADR、既有快照/导入、Windows 权限模拟、部署脚本和仓库门禁；没有宣称全库测试通过。原始记录：`out/hdr-final-full-tests.log`。
- 已完成实现者自审及只读独立评审，修复同文件 DV 回退丢失标识、DV SDR 基础层超分误判及暂不可用轨道查询导致增强锁死的问题。

独立 mpv 冒烟脚本只启动并清理自己的进程，不接触用户正在播放的会话：

```powershell
node scripts/mpv-playback-smoke.mjs
node scripts/mpv-playback-smoke.mjs --fail-remove
node scripts/mpv-playback-smoke.mjs --no-ack
node scripts/mpv-playback-smoke.mjs --render
```

已验证正常换片、删除失败、应答超时，以及保留用户滤镜。`--render` 使用本机 D3D11 渲染并生成 `out/mpv-source-specs.png`，确认右上角显示原始 360p。该合成 SDR 片段不能替代 HDR/DV、RTX 或长时间性能验收。
