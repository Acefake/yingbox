# 影盒安卓端（手机 + 电视）

原生界面（Kotlin + Jetpack Compose），内嵌 Node 运行 `src/server`，原生播放内核。决策与范围见 [ADR-0028](../docs/adr/0028-android-native-shell-embedded-node.md)，Node 的运行方式见 [ADR-0034](../docs/adr/0034-android-node-as-native-executable.md)。

## 现状

P0 进行中。已完成：

- 前台服务 `server/ServerService` 启动内嵌 node 运行 `src/server`：每次随机端口、只监听 `127.0.0.1`，令牌每次安装生成一次，原生端用 `Authorization: Bearer` 访问。
- `server/LocalServer` 守护进程：等 `/api/health` 就绪；意外退出后退避重启，一分钟内退出 3 次就停在失败状态，界面显示 node 最后几行输出。
- 服务端打成 `assets/server.zip`，按安装时间解压到私有目录，同一次安装只解压一次。
- 首页暂时只显示设备模式、服务状态和 `/api/info`。

2026-11-02 在 Android 16 x86_64 模拟器上验证：首次启动约 1 秒就绪；结束 node 进程后自动重启；`am force-stop` 后没有残留的 node 进程；再次启动不重复解压。

Node 暂时用 Termux 编好的版本顶替（ADR-0034 决策 3），只用于开发；正式包换成自己编译、静态链接的 Node 24 LTS（要 Linux 或 Docker）。未验证：arm64 真机、ffprobe、ExoPlayer 杜比视界。

播放内核（ADR-0039）：`playback/engine` 负责能力探测、杜比视界决策、解码器兜底、轨道模型和统计；播放器屏幕只管界面和进度。

NAS 片库（ADR-0040）：设置里填上 NAS 上影盒服务的地址和令牌，导航多出「片库」，直放 NAS 上的文件、外挂字幕、进度写回 NAS。联调：电脑上 `pnpm dev:server`（带 `YINGBOX_MEDIA_ROOTS` 和 `YINGBOX_SERVER_TOKEN`），模拟器里地址填 `10.0.2.2:31480`。

### 播放内核真机检查清单

在目标设备上逐项过，每项看顶部提示，以及 `adb logcat -s YingboxPlayer` 里的「设备能力」「ffmpeg 音频软解可用」「视频 … 方案 …」日志：

- 进入任意播放页：日志有 `ffmpeg 音频软解可用：true`，没有 `ffmpeg 扩展加载失败` 或崩溃
- DV P8：硬件解码器与屏幕都声明支持时尝试原生播放；没有对应解码器时提示兼容层未确认，不把屏幕支持 HDR10 当成转换已成功
- DV P5：没有 DV 解码器的设备顶部提示颜色可能不正确
- DV P7（蓝光双层）：能播基础层，不黑屏
- Atmos（EAC3-JOC）、TrueHD：接功放的设备直通；不接的正常下混
- DTS：平台不支持的设备顶部提示「已改用软解」且有声（样片：`ffmpeg -f lavfi -i sine=frequency=440:duration=10 -c:a dca -strict -2 -b:a 768k dts.mka`）
- AV1：有硬解的设备流畅；没有的给出可读的错误原因
- 24p 片源：电视切到 24Hz，无明显换帧卡顿

### 播放控制层真机检查清单（ADR-0041）

手势、遥控器和焦点没有自动化测试，在手机和电视上逐项过：

- 全屏：进入播放页自动横屏、隐藏状态栏和导航栏（边缘滑一下临时唤出）；右下角按钮切竖屏 / 横屏；退出播放后系统栏和屏幕方向恢复；有刘海的机器上控制层和返回按钮不压住刘海
- 单击画面显示 / 隐藏控制层；播放中 4 秒无操作自动隐藏，暂停、拖进度条时不隐藏
- 双击左 / 右半屏快退 / 快进 10 秒；长按两倍速，松手恢复；左半屏竖滑调亮度、右半屏竖滑调音量，提示在控制层上面
- 缓冲中点播放暂停按钮能真的暂停（图标是「暂停」）
- 拖进度条松手后滑块直接停在松手处；手指按住不动超过 4 秒松手仍然跳转
- 设置面板：音轨、字幕（含「关」）、倍速、画面比例、查看和复制播放诊断；返回键先关面板。诊断不含播放地址、标题、路径，输出模式显示未确认
- 手动上一集 / 下一集：旧集立即停声，进度记到旧集，新集从自己的续播位置开始；换源进行中点也一样
- 电视遥控器：左右键快退 / 快进，确定暂停，上键开设置，下键进控制层按钮、方向键换按钮；面板打开时焦点在面板里，关闭后左右键仍能快退 / 快进
- 右上角「片源」徽标：4K 片显示 4K，杜比视界片显示「杜比视界 P8」，Atmos / TrueHD / DTS 片显示音频格式；随控制层显隐，切音轨和换源后没有上一条流的标识
- HDMI 与音频设备变化后打开诊断，显示能力随路由更新；退出播放不残留监听；未知色彩信息不显示 SDR 或 HDR
- NAS 多版本与剧集：诊断中的兼容号来自实际播放文件；多视频轨或 Profile 冲突时保持未知。兼容号 1/6、2、4 分别显示 HDR10、SDR、HLG 候选，不把候选当成已经输出
- 开播和自适应切换后核对“当前格式原生解码能力”：使用 Media3 检查已知 Profile、level、尺寸与帧率；查询失败保留未知，不循环重建播放器

## 构建

需要 JDK 17 以上（Android Studio 自带的 JBR 即可）、Android SDK（compileSdk 37、build-tools 37.0.0）、`tar`（Windows 10 起系统自带，Git Bash 的 GNU tar 也行）。Gradle 由 wrapper 提供（9.6.0，AGP 9.5.0 的最低要求）。

在仓库根目录：

```bash
pnpm build:android                  # 构建服务端 → 准备 Node → gradle assembleDebug
pnpm build:android --abi x86_64     # 指定 ABI，并重新下载 Node
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.yingbox.android/.MainActivity
adb logcat -s YingboxServer         # node 的输出
```

`pnpm build:android` 依次做三件事：

1. `build:server`，把服务端整理到 `out/packages/yingbox-server`，装运行依赖（不含可选的 `onnxruntime-node`）。
2. `jniLibs` 里没有 Node 时运行 `scripts/android/termux-node.mjs`（默认 x86_64、arm64-v8a）。
3. gradle 的 `packServer` 把整理好的服务端压成 `assets/server.zip`，再 `assembleDebug`。

`app/src/main/jniLibs/`、`app/src/main/assets/node/` 是生成物，不进 git。Gradle 要走代理时设 `GRADLE_OPTS="-Dhttps.proxyHost=… -Dhttps.proxyPort=…"`。

工程路径含非 ASCII 字符时 AGP 会拒绝构建，可以把仓库映射到 ASCII 路径再构建，例如 `cmd /c mklink /J C:\Users\<你>\yb-build "<仓库路径>"`。

模拟器（无真机时）：`sdkmanager 'emulator' 'system-images;android-36;google_apis;x86_64'`，再
`avdmanager create avd -n yb_test -k 'system-images;android-36;google_apis;x86_64' -d pixel_6`，
然后 `emulator -avd yb_test -gpu swiftshader_indirect -no-audio`。

## 约定

- 本目录不进 pnpm workspace；ESLint、Prettier、`check:size` 只管 `src/` 与 TS 代码，不覆盖这里。Kotlin 代码风格以后用 ktlint 或 detekt。
- 构建和发布在本机完成，不使用 GitHub Actions（ADR-0025）。发布标签用 `android-vX.Y.Z`。
- 手机和电视共用一个包：`touchscreen`、`leanback` 都不是必需硬件，同时声明了 `LAUNCHER` 与 `LEANBACK_LAUNCHER`。
- 电视焦点交互是第一优先，手机直接复用同一批页面，只在布局层区分。
