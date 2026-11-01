# 影盒安卓端（手机 + 电视）

原生界面（Kotlin + Jetpack Compose），内嵌 Node 运行 `src/server`，原生播放内核。决策与范围见 [ADR-0028](../docs/adr/0028-android-native-shell-embedded-node.md)。

## 现状

只有空壳：一个 Compose 界面，显示设备被识别成“电视模式”还是“手机模式”。内嵌 Node、视图接口、首页和播放器按 ADR-0028 的阶段逐步接入。

**这个目录还没有在装有 Android SDK 的机器上构建过。** 依赖版本取自 2026-11-01 的官方发布页，写在 `gradle/libs.versions.toml` 里；首次构建以实际结果为准。

## 构建

需要 JDK 17、Android SDK（compileSdk 36），Gradle 由 wrapper 提供（9.6.0，AGP 9.5.0 的最低要求）。

```bash
cd android
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 约定

- 本目录不进 pnpm workspace；ESLint、Prettier、`check:size` 只管 `src/` 与 TS 代码，不覆盖这里。Kotlin 代码风格以后用 ktlint 或 detekt。
- 构建和发布在本机完成，不使用 GitHub Actions（ADR-0025）。发布标签用 `android-vX.Y.Z`。
- 手机和电视共用一个包：`touchscreen`、`leanback` 都不是必需硬件，同时声明了 `LAUNCHER` 与 `LEANBACK_LAUNCHER`。
- 电视焦点交互是第一优先，手机直接复用同一批页面，只在布局层区分。
