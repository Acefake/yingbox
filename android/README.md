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
