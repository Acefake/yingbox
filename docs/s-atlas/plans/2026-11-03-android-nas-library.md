# 安卓连接 NAS 片库并播放 Implementation Plan

> **执行方式：** 当前会话直接执行（用户已确认并要求不等确认）。步骤使用复选框。

**Goal:** 安卓端配置 NAS 地址与令牌后，浏览 NAS 的电影 / 剧集库，直放文件，带外挂字幕和进度写回（规格：`docs/s-atlas/specs/2026-11-03-android-nas-library-design.md`，子项目 B1）。

**Architecture:** 新包 `com.yingbox.android.library`：纯函数（地址规范化、JSON 解析、图片地址转换）加薄的 `LibraryApi`（调 `/api/library/rpc`）。NAS 是第二个 `ServerClient`。播放界面抽出共用的 `PlayerHost`，在线与片库各一个播放屏。

**Tech Stack:** Kotlin、Compose、media3 1.11.1、`org.json`（JVM 测试用 `org.json:json`）。

**验证与授权：** 纯函数用 TDD（JVM 单测）；界面与播放用编译加本机 `src/server` + 模拟器端到端验证（`10.0.2.2` 连本机服务，ffmpeg 生成测试片）。**未授权提交**，提交步骤跳过。

## Global Constraints

- 源码在 `android/app/src/main/kotlin/com/yingbox/android/`，测试在 `android/app/src/test/kotlin/com/yingbox/android/`；注释和文案用简体中文。
- gradle 命令在 `C:\Users\10228\yb-build\android` 下执行，带 `-I C:/Users/10228/yb-init.gradle -Pandroid.overridePathCheck=true -x packServer`。
- 在线播放（`PlayerScreen`）的换源、续播、进度上报行为不变。
- 片库 RPC 方法名、字段以 `src/shared/library/ipc/contract.ts`、`contract-progress.ts` 为准。
- 不改 `src/` 下 TS 代码。

---

### Task 1: NAS 配置、设置页、明文网络

**Files:**
- Create: `library/NasConfig.kt`、`test/.../library/NasConfigTest.kt`、`ui/NasGroup.kt`
- Modify: `settings/DeviceSettings.kt`、`ui/SettingsScreen.kt`、`res/xml/network_security_config.xml`

**Interfaces:**
- Produces: `data class NasConfig(val url: String, val token: String)`；`fun normalizeNasUrl(raw: String): String?`；`DeviceSettings.nas: NasConfig?`、`updateNas(url: String, token: String)`、`clearNas()`；`NasProbe.check(config): NasStatus`（`Ok / Unreachable / Unauthorized`）。

- [ ] 测试：`normalizeNasUrl("192.168.1.5:31480") == "http://192.168.1.5:31480"`；`"http://nas.local/ "` → `"http://nas.local"`；`"https://x.y/a/"` → `"https://x.y/a"`；`""`、`"ftp://x"`、`"a b"` → null。
- [ ] 实现、设置页「NAS」组（地址、令牌、测试连接、清除）、网络安全配置放开明文。
- [ ] 跑 `testDebugUnitTest`，预期全过。

### Task 2: 片库模型、解析与 API

**Files:**
- Create: `library/LibraryModels.kt`、`library/LibraryParsers.kt`、`library/LibraryApi.kt`、`test/.../library/LibraryParsersTest.kt`
- Modify: `gradle/libs.versions.toml`、`app/build.gradle.kts`（`testImplementation("org.json:json")`）

**Interfaces:**
- Produces: `LibraryCard`、`LibraryItem`、`LibraryEpisode`、`LibraryFile`、`LibraryProgress`；`parseQuery(json: JSONObject, base: String): List<LibraryCard>`、`parseItem(json: JSONObject, base: String): LibraryItem`、`parseProgress(json: JSONArray): List<LibraryProgress>`、`mediaImageUrl(base: String, raw: String?, width: Int): String?`；`LibraryApi(client).query / item / progress / saveProgress / subtitles`。

- [ ] 先写解析测试（电影、剧集带季集、缺字段、图片地址三种形态），确认失败，再实现，确认通过。

### Task 3: 共用 PlayerHost 与片库播放

**Files:**
- Create: `ui/PlayerHost.kt`、`ui/LibraryPlayerScreen.kt`
- Modify: `ui/PlayerScreen.kt`

**Interfaces:**
- Produces: `PlayerHost(player, stats, notice, error, onSeek, modifier)`（Compose）：承载 `PlayerView`、遥控按键、提示与错误浮层；`LibraryPlayerScreen(nas: ServerClient, request: LibraryPlayRequest, exit: () -> Unit)`。

- [ ] 抽出 `PlayerHost`，`PlayerScreen` 改用它；编译、单测通过，在线播放真机回归。
- [ ] `LibraryPlayerScreen`：续播位置、外挂字幕、进度写回、下一集。

### Task 4: 片库界面

**Files:**
- Create: `ui/LibraryScreen.kt`、`ui/LibraryDetailScreen.kt`
- Modify: `ui/Shell.kt`（`Tab.Library`）、`MainActivity.kt`

- [ ] 「片库」入口只在 NAS 配置且测试通过时显示；海报网格、搜索、详情、季集、播放。

### Task 5: 端到端与文档

- [ ] 本机 `pnpm dev:server`（媒体根目录含 ffmpeg 生成的测试片：H.264 + AAC、HEVC + DTS 带外挂 srt），模拟器连 `http://10.0.2.2:31480`，验证 配置 → 浏览 → 播放 → 进度写回 → 外挂字幕。
- [ ] `docs/adr/0040-android-nas-library.md`、`AGENTS.md` ADR 索引、`android/README.md`。
