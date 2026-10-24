# ADR-0016 播放器交互照 YouTube，媒体库识别 HDR / 杜比视界并把 P5 交给 mpv

- 状态：已采纳（2026-10-24）
- 相关：PR #137；在 ADR-0015 的播放弹窗之上，不改它的决策

## 背景

播放弹窗（ADR-0015）的控制栏、快捷键和菜单是 Artplayer 默认的一套，和大多数人熟悉的网页播放器习惯不一致：键位少、设置项平铺、进度条悬停看不到所在段落、播完要手动点下一集。

媒体库不知道视频的动态范围。HDR10 / HLG 在 Chromium 里能正常显示；杜比视界只能解基础层，Profile 5 没有 HDR10 / SDR 兼容基础层，内置播放会偏绿偏紫，用户只能自己判断换 mpv。

## 决策

**交互照 YouTube 网页播放器，规则与接线分开（`features/player/`）**

- `hotkeys/`：按键 → 动作的纯映射（空格 / K、J / L ±10 秒、← / → ±5 秒、↑ / ↓ 音量、M、F、I 缩成小窗、C 字幕、0–9 跳百分比、< / > 调速、Shift+N 下一集）；输入法组字中、焦点在输入框、带 Ctrl / ⌘ / Alt 的组合一律不处理。双击：左三分之一后退 10 秒、右三分之一快进 10 秒、中间切全屏。动作后画面中央短暂反馈。
- `settings-menu/`：齿轮菜单固定为字幕 / 播放速度 / 画质 / 音轨 / 弹幕等二级页，一级列表按固定顺序排（别处加进来的项一起排，播放速度是 Artplayer 内置的 `playback-rate`）；选项规则在 `menu-rules.ts`，层级面板用 Artplayer 自带的 setting 组件。倍速档位只有一份（`hotkeys/hotkey-map.ts` 的 `RATE_STEPS`，0.5–2），`createArtCore` 把 `Artplayer.PLAYBACK_RATE` 设为它，< / > 与菜单一致。
- `skip/`：进度条悬停气泡显示时间点，落在片头 / 片尾区间时带段名；播完或片尾卡片的「下一集」倒计时共用 `next-countdown.ts`，暂停时停表，到点切一次。
- `controls/`：会话级的下一集 / 小窗按钮与快捷键接线；小窗按钮和 I 只在设置开着小窗时出现。
- Artplayer 自带热键关着（`art-options` 的 `hotkey: false`），快捷键只挂在 `window` 上一份，随实例销毁移除。Artplayer 的全局双击全屏（`DBCLICK_FULLSCREEN`）关掉，改由 `utils/art-core.ts` 的 `createArtCore` 给每个实例兜底：没有被认领的实例双击仍切全屏，播放弹窗的会话认领后按位置分区。仓库里所有 Artplayer 实例都经 `createArtCore` 创建（没有别处直接 `new Artplayer`）。

**动态范围在媒体库里探测一次、存库**

- 规则在 `shared/video-range.ts`：ffprobe 第一条正片视频流，有 DOVI 配置记录即杜比视界（记 profile 与基础层兼容号），否则按 `color_transfer` 分 HDR10 / HLG / SDR。
- `scanner/video-probe.ts` 在媒体库 utilityProcess 里跑 ffprobe（`engine/entry.ts` 注入，路径经 `tools-host.ts` 向主进程要）；本地盘的库在启动判定存储后、以及每次扫描 / 重解析后排 `probe` 后台任务（网盘模式的库不排；没有待探测文件时是空转），给该库所有未探测的视频补探测，每一小批进同库的扫描 / 整理锁，避开整理任务移文件。结果写进 `files` 表（迁移 v8：`video_range` / `dv_profile` / `dv_compat`，NULL 为未探测、空串为 ffprobe 读完但没有正片视频流或明确是坏数据，内容变化时三列一起清回 NULL）。
- 失败分两种：超时被杀、权限 / I/O 错误、外置盘或网络盘不在、读不到文件的非零退出算瞬时失败，保持 NULL、下一轮再试（本轮按 id 游标走，每个文件最多试一次）；找不到 ffprobe 时整轮停下不写结果，装上 ffmpeg 后重扫即补。
- 海报墙卡片与详情文件列表显示 DV / HDR / HLG 小标，SDR 与未探测不显示。

**杜比视界 P5 的播放路由（`utils/playback-route.ts`）**

- 新设置 `player.dvAutoMpv`（默认开）：起始文件是 P5（或兼容号为 0 的其它 profile）且桌面端有 mpv 桥时先试 mpv；mpv 起不来或在网页端，仍内置播放并提示一次建议安装 mpv。P7 / P8、HDR10、HLG 照常内置播放。

## 后果

- 键位与手势集中在 `hotkeys/`，以后改键只动映射表；纯规则有单元测试，接线靠弹窗测试与实机。
- Artplayer 的双击全屏变成按实例的行为，弹窗以外经 `createArtCore` 创建的实例（如直播页）行为不变（仍双击全屏）；以后若有人绕过 `createArtCore` 直接 `new Artplayer`，会失去双击全屏。
- 升级到 v8 后的第一次启动会在后台给本地盘库里已有的视频补一次 ffprobe（同一进程里全局最多 2 个 ffprobe，多个库同时补探测也共用这个上限；优先级与指纹相同），补完之前不显示小标、也不走 P5 路由；网络盘上会慢一些。
- 网盘模式的库不探测，没有小标，杜比视界 P5 也不会自动切 mpv。
- HDR 的显示效果仍取决于系统与显示器：Windows 关闭 HDR 时 Chromium 会做色调映射，这里不做额外处理。

## 不在本次范围

- 影院模式（YouTube 的宽屏模式）：弹窗已有全屏与小窗，再加一档收益小。
- 进度条章节分段：只有片头 / 片尾两段，用悬停段名表达，不切分进度条。
- 画质 / 音轨切换只对 HLS 生效：本地文件的多音轨需要另一条解码路线，留给 mpv。

## 否决方案

- 播放时临时探测动态范围：每次开播多一次 ffprobe 延迟，网页端也拿不到结果；存库后卡片小标与路由共用一份数据。
- 所有杜比视界都交给 mpv：P7 / P8 有兼容基础层，内置播放颜色正确，强制外部播放器得不偿失。
- 保留 Artplayer 全局双击全屏、再在弹窗里拦截：全局开关无法按实例关闭，两套逻辑会同时触发。
