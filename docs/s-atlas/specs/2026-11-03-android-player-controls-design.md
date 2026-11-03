# 安卓播放器控制层（子项目 C）

日期：2026-11-03
状态：设计已定（用户要求不等确认直接开发）

## 背景与目标

A 给了播放内核，B1 让 NAS 文件能播。现在播放界面还是 media3 自带的 `PlayerView` 控制条：没有音轨、字幕、倍速、画面比例入口，看不到杜比视界 / HDR / Atmos 这类信息，也没有手势。C 用 Compose 自绘控制层，做到 Infuse 那样「信息清楚、操作顺手」。

不在范围内：片头片尾跳过、画中画、MediaSession 通知、字幕样式（大小、描边）、章节、字幕延迟与音频延迟调整，留给后续。

## 决策

1. **关掉 `PlayerView` 自带控制条**（`useController = false`），画面仍由 `PlayerView`（`SurfaceView`）渲染；控制层是盖在上面的 Compose。在线播放（`PlayerScreen`）与片库播放（`LibraryPlayerScreen`）共用 `PlayerHost`，所以两边同时得到新控制层。
2. **播放状态进 `PlayerState`。** 播放中、倍速、画面比例、轨道（`Tracks`）都是 Compose 状态，由 `Player.Listener` 更新；进度（位置、缓冲位置、时长）由控制层可见时每 500 ms 轮询。
3. **信息徽标**来自 A 的统计与轨道：分辨率（4K / 1080p …）、动态范围（杜比视界 P8 / HDR10 / HLG）、音频（Atmos / TrueHD / DTS-HD / DTS:X）。徽标规则是纯函数，JVM 单测覆盖。
4. **设置面板**：音轨、字幕（含「关」）、倍速（0.5 – 2.0）、画面比例（适应 / 填充 / 拉伸）、统计信息开关。音轨与字幕直接用 A 的 `Tracks.options` / `Player.select`。
5. **手势（触屏）**：单击显示 / 隐藏控制层；双击左 / 右半屏快退 / 快进 10 秒；长按两倍速（松手恢复）；左半屏上下滑调亮度、右半屏上下滑调音量。手势的数值换算（滑动距离 → 亮度 / 音量增量）是纯函数。
6. **遥控器**：保持现有按键（左右键快退 / 快进、确定暂停）；按任意方向键或确定键唤出控制层，上键聚焦到设置按钮。控制层 4 秒无操作自动隐藏，暂停时不隐藏。
7. **样式**沿用影盒的深色玻璃（`ybGlass`、令牌间距与字号），控制层只用已有的颜色与组件，不新增视觉语言。

## 结构

新增（`android/.../ui/` 与 `playback/engine/`）：

- `playback/engine/PlayerFormat.kt`：纯函数 `formatClock(ms)`（`1:02:03` / `02:03`，未知为 `--:--`）、`playbackBadges(video, audioMime)`、`gestureDelta(dragPx, heightPx)`、`SPEED_STEPS`、`speedLabel`。
- `ui/PlayerState`（扩展）：`isPlaying`、`speed`、`resizeMode`、`tracks`、`showStats`。
- `ui/PlayerControls.kt`：顶栏（返回由外层给、标题、徽标）、中间的播放控制、底部（进度条、时间、设置按钮）、自动隐藏、手势层。
- `ui/PlayerSettingsSheet.kt`：设置面板。

`PlayerHost(state, title, onPrevious, onNext)` 接标题与上一集 / 下一集回调（没有为 null，对应按钮置灰）。

## 测试

- JVM 单测：`formatClock`、`playbackBadges`、`gestureDelta`。
- 界面：编译加模拟器截图检查（控制层、设置面板）；真实手势与遥控器操作在真机上验证。
