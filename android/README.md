# 影盒安卓端（手机 + 电视）

原生界面（Kotlin + Jetpack Compose），内嵌 Node 运行 `src/server`，原生播放内核。决策与范围见 [ADR-0028](../docs/adr/0028-android-native-shell-embedded-node.md)。

## 现状

只有空壳：一个 Compose 界面，显示设备被识别成“电视模式”还是“手机模式”。内嵌 Node、视图接口、首页和播放器按 ADR-0028 的阶段逐步接入。

2026-11-01 在 Windows 上用 JDK 17 + Android SDK 37 首次构建通过，`app-debug.apk` 装到 Android 16 模拟器上能启动并渲染两个文字。首次构建暴露并已修正的三处：

- AGP 9 内置 Kotlin 支持，不能再应用 `org.jetbrains.kotlin.android`（应用即失败），已从两个 `build.gradle.kts` 和 `libs.versions.toml` 移除。
- `compose-bom 2026.08.00` 的 AAR 元数据要求依赖方 `compileSdk >= 37`，`compileSdk` 由 36 改为 37（`targetSdk` 同步到 37）。
- 工程路径含非 ASCII 字符时 AGP 会直接拒绝构建。Windows 上把仓库映射到 ASCII 路径再构建，例如：
  `cmd /c mklink /J C:\Users\<你>\yb-build "<仓库路径>"`，然后 `cd C:\Users\<你>\yb-build\android`。

## 构建

需要 JDK 17、Android SDK（compileSdk 37、build-tools 37.0.0），Gradle 由 wrapper 提供（9.6.0，AGP 9.5.0 的最低要求）。

```bash
cd android
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.yingbox.android/.MainActivity
```

模拟器（无真机时）：`sdkmanager 'emulator' 'system-images;android-36;google_apis;x86_64'`，再
`avdmanager create avd -n yb_test -k 'system-images;android-36;google_apis;x86_64' -d pixel_6`，
然后 `emulator -avd yb_test -gpu swiftshader_indirect -no-audio`。

## 约定

- 本目录不进 pnpm workspace；ESLint、Prettier、`check:size` 只管 `src/` 与 TS 代码，不覆盖这里。Kotlin 代码风格以后用 ktlint 或 detekt。
- 构建和发布在本机完成，不使用 GitHub Actions（ADR-0025）。发布标签用 `android-vX.Y.Z`。
- 手机和电视共用一个包：`touchscreen`、`leanback` 都不是必需硬件，同时声明了 `LAUNCHER` 与 `LEANBACK_LAUNCHER`。
- 电视焦点交互是第一优先，手机直接复用同一批页面，只在布局层区分。
