# 安卓播放内核 Implementation Plan

> **执行方式：** 按已确认方式使用 executing-plans；已授权子代理执行时使用 subagent-driven-development。仅要求写计划不授权实现。步骤使用复选框。

**Goal:** 把 `PlayerScreen.kt` 里直接构造的 ExoPlayer 换成带能力探测、杜比视界决策、解码器兜底、音频软解、轨道模型和统计的播放内核（规格：`docs/s-atlas/specs/2026-11-03-android-player-core-design.md`，子项目 A）。

**Architecture:** 新包 `com.yingbox.android.playback.engine`。决策、解析、命名都是不依赖 Android 的纯函数，用 JVM 单元测试覆盖；`CapabilitiesProbe`、`PlayerFactory`、`StatsCollector`、轨道适配器是薄的 Android 适配层，用编译加真机检查验证。`PlayerScreen.kt` 只保留界面、进度上报与换源。

**Tech Stack:** Kotlin 2.4.10、AGP 9.5.0、media3 1.11.1（`exoplayer`、`ui`）、JUnit 4.13.2（新增）、`org.jellyfin.media3:media3-ffmpeg-decoder`（新增，音频软解）。

**验证与授权：** 纯函数任务用 TDD（先失败后通过）；适配层任务用 `compileDebugKotlin` 加真机日志验证。`PlayerScreen.kt` 改动属于改行为，需自审加只读评审。**未授权提交**：所有提交步骤跳过，保留工作区修改。

## Global Constraints

- 包名 `com.yingbox.android.playback.engine`，源码在 `android/app/src/main/kotlin/com/yingbox/android/playback/engine/`，测试在 `android/app/src/test/kotlin/com/yingbox/android/playback/engine/`。
- 注释和面向用户的文案用简体中文；标识符保持英文。
- 软解只作兜底，不作默认：`EXTENSION_RENDERER_MODE_ON`（平台解码器优先）。
- 渲染固定 `SurfaceView`（`PlayerView` 默认即是，不改成 `TextureView`）。
- 帧率切换策略仅无缝时执行：`C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS`。
- 不改 `src/` 下任何 TS 代码；本计划只动 `android/` 和 `docs/`。
- 仓库路径含非 ASCII 字符，AGP 会拒绝构建。所有 gradle 命令都在 ASCII 路径下执行。若不存在先在 PowerShell 建联接：`cmd /c mklink /J C:\Users\10228\yb-build "C:\Users\10228\OneDrive\桌面\项目\yingbox"`，然后 `cd /c/Users/10228/yb-build/android`。
- gradle 命令一律带 `-x packServer`（不需要服务端 zip；否则要先 `pnpm build:android`）。
- 范围外：新的控制层界面（子项目 C）、文件来源（B1、B2）、服务端重建（D）、AV1 软解（见 Task 8）。

---

### Task 1: 测试脚手架与视频信息解析

**Files:**

- Modify: `android/gradle/libs.versions.toml`
- Modify: `android/app/build.gradle.kts`（dependencies 块）
- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/VideoInfo.kt`
- Test: `android/app/src/test/kotlin/com/yingbox/android/playback/engine/VideoInfoTest.kt`

**Interfaces:**

- Produces:
  - `enum class HdrKind(val label: String) { Sdr, Hdr10, Hlg, DolbyVision }`
  - `data class DvInfo(val profile: Int, val level: Int)`
  - `data class VideoInfo(val width: Int, val height: Int, val hdr: HdrKind, val dv: DvInfo?, val codecs: String?)`
  - `fun parseDv(codecs: String?): DvInfo?`
  - `fun videoInfo(width: Int, height: Int, codecs: String?, colorTransfer: Int): VideoInfo`

- [ ] **Step 1: 加测试依赖**

`android/gradle/libs.versions.toml`，`[versions]` 末尾加 `junit = "4.13.2"`，`[libraries]` 末尾加：

```toml
junit = { module = "junit:junit", version.ref = "junit" }
```

`android/app/build.gradle.kts` 的 `dependencies { … }` 末尾加：

```kotlin
    testImplementation(libs.junit)
```

- [ ] **Step 2: 写失败测试**

```kotlin
package com.yingbox.android.playback.engine

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VideoInfoTest {
    @Test fun `解析 P8 编码串`() {
        assertEquals(DvInfo(8, 6), parseDv("dvhe.08.06"))
    }

    @Test fun `多个编码里找到杜比视界`() {
        assertEquals(DvInfo(5, 9), parseDv("hvc1.2.4.L153.B0, dvh1.05.09"))
    }

    @Test fun `AV1 的杜比视界是 profile 10`() {
        assertEquals(DvInfo(10, 9), parseDv("dav1.10.09"))
    }

    @Test fun `普通 HEVC 和空值都不是杜比视界`() {
        assertNull(parseDv("hvc1.2.4.L153.B0"))
        assertNull(parseDv(null))
    }

    @Test fun `PQ 传输特性是 HDR10`() {
        val v = videoInfo(3840, 2160, "hvc1.2.4.L153.B0", C.COLOR_TRANSFER_ST2084)
        assertEquals(HdrKind.Hdr10, v.hdr)
        assertNull(v.dv)
    }

    @Test fun `HLG 传输特性是 HLG`() {
        assertEquals(HdrKind.Hlg, videoInfo(1920, 1080, null, C.COLOR_TRANSFER_HLG).hdr)
    }

    @Test fun `没有传输特性是 SDR`() {
        assertEquals(HdrKind.Sdr, videoInfo(1920, 1080, "avc1.640028", C.COLOR_TRANSFER_SDR).hdr)
    }

    @Test fun `杜比视界编码串优先于传输特性`() {
        val v = videoInfo(3840, 2160, "dvhe.08.06", C.COLOR_TRANSFER_ST2084)
        assertEquals(HdrKind.DolbyVision, v.hdr)
        assertEquals(DvInfo(8, 6), v.dv)
    }
}
```

- [ ] **Step 3: 确认失败**

Run（在 `C:\Users\10228\yb-build\android`）: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.VideoInfoTest"`
Expected: FAIL，`Unresolved reference: parseDv`（编译失败）。

- [ ] **Step 4: 写实现**

```kotlin
package com.yingbox.android.playback.engine

import androidx.media3.common.C

/** 画面的动态范围 */
enum class HdrKind(val label: String) {
    Sdr("SDR"),
    Hdr10("HDR10"),
    Hlg("HLG"),
    DolbyVision("杜比视界"),
}

/** 杜比视界配置：编码串 dvhe.08.06 → profile 8、level 6 */
data class DvInfo(val profile: Int, val level: Int)

/** 一路视频的规格（纯数据，由 [com.yingbox.android.playback.engine.toVideoInfo] 从播放器格式转来） */
data class VideoInfo(
    val width: Int,
    val height: Int,
    val hdr: HdrKind,
    val dv: DvInfo?,
    val codecs: String?,
)

/** dvhe / dvh1：HEVC；dvav / dva1：AVC；dav1：AV1 */
private val DV_CODEC = Regex("""^(?:dvhe|dvh1|dvav|dva1|dav1)\.(\d{2})\.(\d{2})""")

/** 编码串里的杜比视界配置；编码串可以是逗号分隔的多个。 */
fun parseDv(codecs: String?): DvInfo? {
    if (codecs == null) return null
    for (part in codecs.split(',')) {
        val match = DV_CODEC.find(part.trim()) ?: continue
        return DvInfo(match.groupValues[1].toInt(), match.groupValues[2].toInt())
    }
    return null
}

/** 编码串里有杜比视界就算杜比视界，否则按传输特性判断 HDR10 / HLG。 */
fun videoInfo(width: Int, height: Int, codecs: String?, colorTransfer: Int): VideoInfo {
    val dv = parseDv(codecs)
    val hdr = when {
        dv != null -> HdrKind.DolbyVision
        colorTransfer == C.COLOR_TRANSFER_ST2084 -> HdrKind.Hdr10
        colorTransfer == C.COLOR_TRANSFER_HLG -> HdrKind.Hlg
        else -> HdrKind.Sdr
    }
    return VideoInfo(width, height, hdr, dv, codecs)
}
```

- [ ] **Step 5: 确认通过**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.VideoInfoTest"`
Expected: `BUILD SUCCESSFUL`，8 个用例通过。

- [ ] **Step 6: 自审**

按 code-style 审本任务差异：正则覆盖的前缀与 Dolby 规范一致、`groupValues` 转 `Int` 不会越界（两位数字）、`HdrKind.label` 是否被后续任务使用。记录结论。

- [ ] **Step 7: 独立评审**

本任务为纯函数加测试，用轻量评审：派只读 subagent 按 requesting-code-review 审 `VideoInfo.kt` 与测试，不改文件。

- [ ] **Step 8: 提交**：未授权，跳过。

---

### Task 2: 能力模型与播放决策

**Files:**

- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayDecision.kt`
- Test: `android/app/src/test/kotlin/com/yingbox/android/playback/engine/PlayDecisionTest.kt`

**Interfaces:**

- Consumes: `HdrKind`、`DvInfo`、`VideoInfo`（Task 1）。
- Produces:
  - `data class Capabilities(val dvProfiles: Set<Int>, val displayHdr: Set<HdrKind>, val displayHdr10Plus: Boolean, val av1Hardware: Boolean, val passthroughAtmos: Boolean, val passthroughTrueHd: Boolean, val passthroughDtsHd: Boolean)`，伴生 `Capabilities.NONE`
  - `sealed interface VideoPlan { Direct; BaseLayer(shownAs: HdrKind); ColorRisk }`
  - `fun planVideo(video: VideoInfo, caps: Capabilities): VideoPlan`
  - `fun VideoPlan.notice(): String?`
  - （`softwareAudioNotice` 依赖 Task 4 的 `audioCodecName`，放在 Task 4 追加到同一文件）

- [ ] **Step 1: 写失败测试**

```kotlin
package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayDecisionTest {
    private fun caps(dv: Set<Int> = emptySet(), hdr: Set<HdrKind> = emptySet()) =
        Capabilities.NONE.copy(dvProfiles = dv, displayHdr = hdr)

    private fun dv(profile: Int) = VideoInfo(3840, 2160, HdrKind.DolbyVision, DvInfo(profile, 6), "dvhe.0$profile.06")

    private val hdr10 = VideoInfo(3840, 2160, HdrKind.Hdr10, null, "hvc1.2.4.L153.B0")

    @Test fun `非杜比视界原样解码`() {
        assertEquals(VideoPlan.Direct, planVideo(hdr10, caps()))
    }

    @Test fun `设备有对应 DV 解码器就走 DV`() {
        assertEquals(VideoPlan.Direct, planVideo(dv(8), caps(dv = setOf(8))))
    }

    @Test fun `P8 没有 DV 解码器，屏幕支持 HDR10 就按 HDR10 显示`() {
        assertEquals(
            VideoPlan.BaseLayer(HdrKind.Hdr10),
            planVideo(dv(8), caps(hdr = setOf(HdrKind.Hdr10))),
        )
    }

    @Test fun `P7 没有 DV 解码器，屏幕不支持 HDR 就按 SDR 显示`() {
        assertEquals(VideoPlan.BaseLayer(HdrKind.Sdr), planVideo(dv(7), caps()))
    }

    @Test fun `P5 没有 DV 解码器有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(hdr = setOf(HdrKind.Hdr10))))
    }

    @Test fun `解码器只支持 P8 时 P5 仍有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(dv = setOf(8))))
    }

    @Test fun `提示文案`() {
        assertNull(VideoPlan.Direct.notice())
        assertEquals("本设备不支持杜比视界，已按 HDR10 播放", VideoPlan.BaseLayer(HdrKind.Hdr10).notice())
        assertEquals("本设备不支持杜比视界，已按 SDR 播放", VideoPlan.BaseLayer(HdrKind.Sdr).notice())
        assertEquals("本设备不支持杜比视界 Profile 5，颜色可能不正确", VideoPlan.ColorRisk.notice())
    }
}
```

- [ ] **Step 2: 确认失败**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.PlayDecisionTest"`
Expected: FAIL，`Unresolved reference: Capabilities`。

- [ ] **Step 3: 写实现**

```kotlin
package com.yingbox.android.playback.engine

/** 设备在启动时探测一次的播放能力（探测见 [CapabilitiesProbe]） */
data class Capabilities(
    /** 硬件杜比视界解码器支持的 profile（5、7、8 …） */
    val dvProfiles: Set<Int>,
    /** 屏幕支持的 HDR（只含 Hdr10 / Hlg / DolbyVision） */
    val displayHdr: Set<HdrKind>,
    val displayHdr10Plus: Boolean,
    val av1Hardware: Boolean,
    val passthroughAtmos: Boolean,
    val passthroughTrueHd: Boolean,
    val passthroughDtsHd: Boolean,
) {
    companion object {
        /** 什么都不支持（测试用，探测失败时也退到它） */
        val NONE = Capabilities(emptySet(), emptySet(), false, false, false, false, false)
    }
}

/** 这一路视频该怎么放 */
sealed interface VideoPlan {
    /** 按片源原样解码（含设备有对应 DV 解码器的杜比视界） */
    data object Direct : VideoPlan

    /** 设备没有对应的 DV 解码器，退到 HEVC 基础层，画面按 [shownAs] 显示 */
    data class BaseLayer(val shownAs: HdrKind) : VideoPlan

    /** P5 没有兼容基础层，设备又没有 DV 解码器，颜色会偏 */
    data object ColorRisk : VideoPlan
}

/** 杜比视界的决策表（规格「决策表」前三行）。 */
fun planVideo(video: VideoInfo, caps: Capabilities): VideoPlan {
    val dv = video.dv ?: return VideoPlan.Direct
    if (dv.profile in caps.dvProfiles) return VideoPlan.Direct
    if (dv.profile == 5) return VideoPlan.ColorRisk
    val shown = if (HdrKind.Hdr10 in caps.displayHdr) HdrKind.Hdr10 else HdrKind.Sdr
    return VideoPlan.BaseLayer(shown)
}

/** 要给用户看的提示；原样解码时没有。 */
fun VideoPlan.notice(): String? = when (this) {
    VideoPlan.Direct -> null
    is VideoPlan.BaseLayer -> "本设备不支持杜比视界，已按 ${shownAs.label} 播放"
    VideoPlan.ColorRisk -> "本设备不支持杜比视界 Profile 5，颜色可能不正确"
}
```

- [ ] **Step 4: 确认通过**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.PlayDecisionTest"`
Expected: `BUILD SUCCESSFUL`，7 个用例通过。

- [ ] **Step 5: 自审**：对照规格决策表前三行逐条核对；确认 P5 且解码器只含 P8 的边界已有用例。
- [ ] **Step 6: 独立评审**：轻量评审，范围 `PlayDecision.kt` 与测试。
- [ ] **Step 7: 提交**：未授权，跳过。

---

### Task 3: 错误码中文映射

**Files:**

- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/Errors.kt`
- Test: `android/app/src/test/kotlin/com/yingbox/android/playback/engine/ErrorsTest.kt`

**Interfaces:**

- Produces: `fun describeError(code: Int, name: String): String`（`code` 为 `PlaybackException.errorCode`，`name` 为 `errorCodeName`）

- [ ] **Step 1: 写失败测试**

```kotlin
package com.yingbox.android.playback.engine

import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorsTest {
    @Test fun `解码器初始化失败`() {
        assertTrue(describeError(PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, "X").contains("解码器"))
    }

    @Test fun `规格超出能力`() {
        assertTrue(describeError(PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES, "X").contains("超出"))
    }

    @Test fun `网络超时和连接失败同一句话`() {
        assertEquals(
            describeError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, "A"),
            describeError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, "B"),
        )
    }

    @Test fun `不认识的错误码带上错误名`() {
        assertEquals("播放出错（ERROR_CODE_WHATEVER）", describeError(999_999, "ERROR_CODE_WHATEVER"))
    }
}
```

- [ ] **Step 2: 确认失败**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.ErrorsTest"`
Expected: FAIL，`Unresolved reference: describeError`。

- [ ] **Step 3: 写实现**

```kotlin
package com.yingbox.android.playback.engine

import androidx.media3.common.PlaybackException

/** 播放错误码 → 说得清原因的中文；不认识的带上错误名，方便对日志。 */
fun describeError(code: Int, name: String): String = when (code) {
    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> "解码器初始化失败，本设备可能不支持这种编码"
    PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "视频规格超出本设备的解码能力"
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "本设备不支持这种音视频格式"
    PlaybackException.ERROR_CODE_DECODING_FAILED -> "解码失败"
    PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
    PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED -> "音频输出失败，请检查音频设备"
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "网络连接失败或超时"
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "服务器拒绝了请求"
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "文件不存在"
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "不支持这种封装格式，或文件已损坏"
    else -> "播放出错（$name）"
}
```

- [ ] **Step 4: 确认通过**

Run: 同 Step 2 命令。Expected: `BUILD SUCCESSFUL`，4 个用例通过。

- [ ] **Step 5: 自审**；Step 6: 轻量独立评审（范围 `Errors.kt` 与测试）；Step 7: 未授权提交，跳过。

---

### Task 4: 轨道命名与软解提示

**Files:**

- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/TrackModel.kt`
- Modify: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayDecision.kt`（末尾追加 `softwareAudioNotice`）
- Test: `android/app/src/test/kotlin/com/yingbox/android/playback/engine/TrackModelTest.kt`

**Interfaces:**

- Produces:
  - `data class TrackDescriptor(val language: String?, val label: String?, val mimeType: String?, val channels: Int, val external: Boolean = false, val selected: Boolean = false)`
  - `fun audioLabel(d: TrackDescriptor): String`、`fun subtitleLabel(d: TrackDescriptor): String`
  - `fun audioCodecName(mimeType: String?): String?`
  - `fun softwareAudioNotice(decoderName: String?, mimeType: String?): String?`（在 `PlayDecision.kt`）

- [ ] **Step 1: 写失败测试**

```kotlin
package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackModelTest {
    private fun audio(lang: String?, mime: String?, ch: Int, label: String? = null) =
        TrackDescriptor(lang, label, mime, ch)

    @Test fun `Atmos 7_1`() {
        assertEquals("中文 · Atmos 7.1", audioLabel(audio("chi", "audio/eac3-joc", 8)))
    }

    @Test fun `TrueHD 和 DTS`() {
        assertEquals("英语 · TrueHD 7.1", audioLabel(audio("eng", "audio/true-hd", 8)))
        assertEquals("日语 · DTS 5.1", audioLabel(audio("jpn", "audio/vnd.dts", 6)))
        assertEquals("英语 · DTS-HD 5.1", audioLabel(audio("eng", "audio/vnd.dts.hd", 6)))
    }

    @Test fun `没有语言时只有编码和声道`() {
        assertEquals("AC3 2.0", audioLabel(audio("und", "audio/ac3", 2)))
        assertEquals("AAC 2.0", audioLabel(audio(null, "audio/mp4a-latm", 2)))
    }

    @Test fun `轨道标题追加在末尾`() {
        assertEquals("英语 · AC3 5.1 (导演评论)", audioLabel(audio("eng", "audio/ac3", 6, "导演评论")))
    }

    @Test fun `什么都不知道时有兜底名`() {
        assertEquals("音轨", audioLabel(audio(null, null, -1)))
        assertEquals("字幕", subtitleLabel(TrackDescriptor(null, null, null, -1)))
    }

    @Test fun `字幕`() {
        assertEquals("中文 · PGS", subtitleLabel(TrackDescriptor("zho", null, "application/pgs", -1)))
        assertEquals("英语 · ASS · 外挂", subtitleLabel(TrackDescriptor("eng", null, "text/x-ssa", -1, external = true)))
        assertEquals("中文 · SRT", subtitleLabel(TrackDescriptor("chs", null, "application/x-subrip", -1)))
    }

    @Test fun `不认识的语言原样显示`() {
        assertEquals("xx · AC3 2.0", audioLabel(audio("xx", "audio/ac3", 2)))
    }

    @Test fun `软解提示`() {
        assertEquals(
            "本设备不支持 DTS，已改用软解",
            softwareAudioNotice("ffmpeg6.0-dca", "audio/vnd.dts"),
        )
        assertNull(softwareAudioNotice("c2.android.eac3.decoder", "audio/eac3"))
        assertNull(softwareAudioNotice(null, "audio/ac3"))
    }
}
```

- [ ] **Step 2: 确认失败**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.TrackModelTest"`
Expected: FAIL，`Unresolved reference: TrackDescriptor`。

- [ ] **Step 3: 写 `TrackModel.kt`**

```kotlin
package com.yingbox.android.playback.engine

import java.util.Locale

/** 一条音轨或字幕轨的描述（纯数据，由 [options] 从播放器轨道转来） */
data class TrackDescriptor(
    val language: String?,
    val label: String?,
    val mimeType: String?,
    val channels: Int,
    /** 外挂字幕（B 创建外挂字幕时 id 用 [EXTERNAL_ID_PREFIX] 开头） */
    val external: Boolean = false,
    val selected: Boolean = false,
)

/** 外挂字幕的轨道 id 前缀 */
const val EXTERNAL_ID_PREFIX = "ext:"

/** 片源里常见的三字母 / 变体语言码；别的交给系统本地化名称 */
private val LANGUAGES = mapOf(
    "chi" to "中文", "zho" to "中文", "chs" to "中文", "cht" to "中文", "cmn" to "中文", "zh" to "中文",
    "eng" to "英语", "en" to "英语",
    "jpn" to "日语", "ja" to "日语",
    "kor" to "韩语", "ko" to "韩语",
    "fra" to "法语", "fre" to "法语", "fr" to "法语",
    "deu" to "德语", "ger" to "德语", "de" to "德语",
    "spa" to "西班牙语", "es" to "西班牙语",
    "rus" to "俄语", "ru" to "俄语",
)

private fun languageName(code: String?): String? {
    val tag = code?.trim()?.lowercase()
    if (tag.isNullOrEmpty() || tag == "und") return null
    LANGUAGES[tag]?.let { return it }
    val shown = Locale.forLanguageTag(tag).getDisplayLanguage(Locale.CHINESE)
    return shown.takeIf { it.isNotEmpty() && it != tag } ?: tag
}

private val AUDIO_CODECS = mapOf(
    "audio/eac3-joc" to "Atmos",
    "audio/true-hd" to "TrueHD",
    "audio/vnd.dts.uhd;profile=p2" to "DTS:X",
    "audio/vnd.dts.hd" to "DTS-HD",
    "audio/vnd.dts.hd;profile=lbr" to "DTS Express",
    "audio/vnd.dts" to "DTS",
    "audio/eac3" to "EAC3",
    "audio/ac3" to "AC3",
    "audio/mp4a-latm" to "AAC",
    "audio/opus" to "Opus",
    "audio/flac" to "FLAC",
    "audio/raw" to "PCM",
)

private val SUBTITLE_CODECS = mapOf(
    "application/pgs" to "PGS",
    "text/x-ssa" to "ASS",
    "application/x-subrip" to "SRT",
    "text/vtt" to "VTT",
    "application/vobsub" to "VobSub",
    "application/dvbsubs" to "DVB",
)

/** 音频 MIME → 给人看的编码名；不认识为 null */
fun audioCodecName(mimeType: String?): String? = AUDIO_CODECS[mimeType]

private fun channelName(channels: Int): String? = when {
    channels <= 0 -> null
    channels == 1 -> "1.0"
    channels == 2 -> "2.0"
    channels == 6 -> "5.1"
    channels == 8 -> "7.1"
    else -> "${channels}声道"
}

/** 「语言 · 编码 声道」，轨道有标题就追加在末尾；什么都不知道时叫「音轨」。 */
fun audioLabel(d: TrackDescriptor): String {
    val spec = listOfNotNull(audioCodecName(d.mimeType), channelName(d.channels)).joinToString(" ")
    val main = listOfNotNull(languageName(d.language), spec.ifEmpty { null }).joinToString(" · ")
    val title = d.label?.trim()?.takeIf { it.isNotEmpty() }
    return when {
        main.isEmpty() && title == null -> "音轨"
        title == null -> main
        main.isEmpty() -> title
        else -> "$main ($title)"
    }
}

/** 「语言 · 格式」，外挂字幕末尾加「外挂」；什么都不知道时叫「字幕」。 */
fun subtitleLabel(d: TrackDescriptor): String {
    val parts = listOfNotNull(languageName(d.language), SUBTITLE_CODECS[d.mimeType], if (d.external) "外挂" else null)
    return parts.joinToString(" · ").ifEmpty { d.label?.trim()?.takeIf { it.isNotEmpty() } ?: "字幕" }
}
```

- [ ] **Step 4: 在 `PlayDecision.kt` 末尾追加**

```kotlin

/** 音频解码器是 ffmpeg 软解时的提示（平台解码器不提示）。 */
fun softwareAudioNotice(decoderName: String?, mimeType: String?): String? {
    if (decoderName == null || !decoderName.startsWith("ffmpeg", ignoreCase = true)) return null
    val codec = audioCodecName(mimeType) ?: "这种音频"
    return "本设备不支持 $codec，已改用软解"
}
```

- [ ] **Step 5: 确认通过**

Run: `./gradlew :app:testDebugUnitTest -x packServer --tests "com.yingbox.android.playback.engine.*"`
Expected: `BUILD SUCCESSFUL`，Task 1–4 全部用例通过。

- [ ] **Step 6: 自审**：核对 `audioLabel` 四种分支（只有标题、只有主体、都有、都没有）；`languageName` 对 `und`、空串、`null` 返回 `null`。
- [ ] **Step 7: 独立评审**：轻量评审，范围 `TrackModel.kt`、`PlayDecision.kt` 追加段与测试。
- [ ] **Step 8: 提交**：未授权，跳过。

---

### Task 5: 能力探测与格式适配

**Files:**

- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/CapabilitiesProbe.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/FormatExt.kt`

**Interfaces:**

- Consumes: `Capabilities`、`HdrKind`（Task 2）、`VideoInfo`、`videoInfo`（Task 1）。
- Produces:
  - `object CapabilitiesProbe { fun get(context: Context): Capabilities }`（进程内只探一次，线程安全）
  - `fun Format.toVideoInfo(): VideoInfo`

- [ ] **Step 1: 写 `FormatExt.kt`**

```kotlin
package com.yingbox.android.playback.engine

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi

/** 播放器的视频格式 → [VideoInfo] */
@OptIn(UnstableApi::class)
fun Format.toVideoInfo(): VideoInfo =
    videoInfo(width, height, codecs, colorInfo?.colorTransfer ?: Format.NO_VALUE)
```

- [ ] **Step 2: 写 `CapabilitiesProbe.kt`**

```kotlin
package com.yingbox.android.playback.engine

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities

private const val TAG = "YingboxPlayer"

/** 探测设备的解码器、屏幕 HDR 和音频直通能力。结果缓存一次，探测失败的部分按「不支持」处理。 */
@OptIn(UnstableApi::class)
object CapabilitiesProbe {
    @Volatile
    private var cached: Capabilities? = null

    fun get(context: Context): Capabilities =
        cached ?: synchronized(this) {
            cached ?: probe(context.applicationContext).also { cached = it }
        }

    private fun probe(context: Context): Capabilities {
        val decoders = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        }.getOrElse {
            Log.w(TAG, "枚举解码器失败", it)
            emptyList()
        }
        val displayHdr = displayHdrTypes(context)
        val audio = runCatching { AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null) }.getOrNull()
        val caps = Capabilities(
            dvProfiles = dvProfiles(decoders),
            displayHdr = buildSet {
                if (Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in displayHdr) add(HdrKind.DolbyVision)
                if (Display.HdrCapabilities.HDR_TYPE_HDR10 in displayHdr) add(HdrKind.Hdr10)
                if (Display.HdrCapabilities.HDR_TYPE_HLG in displayHdr) add(HdrKind.Hlg)
            },
            displayHdr10Plus = Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in displayHdr,
            av1Hardware = decoders.any { hasType(it, MimeTypes.VIDEO_AV1) && isHardware(it) },
            passthroughAtmos = audio?.supportsEncoding(C.ENCODING_E_AC3_JOC) == true,
            passthroughTrueHd = audio?.supportsEncoding(C.ENCODING_DOLBY_TRUEHD) == true,
            passthroughDtsHd = audio?.supportsEncoding(C.ENCODING_DTS_HD) == true,
        )
        Log.i(TAG, "设备能力：$caps")
        return caps
    }

    private fun hasType(info: MediaCodecInfo, mime: String): Boolean =
        info.supportedTypes.any { it.equals(mime, ignoreCase = true) }

    private fun isHardware(info: MediaCodecInfo): Boolean =
        if (Build.VERSION.SDK_INT >= 29) {
            info.isHardwareAccelerated
        } else {
            !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")
        }

    /** DV profile 常量是按位的（Dvhe.Stn = 0x20 = profile 5，DvheSt = 0x100 = profile 8），末尾零的个数就是 profile 号 */
    private fun dvProfiles(decoders: List<MediaCodecInfo>): Set<Int> = buildSet {
        for (info in decoders) {
            if (!hasType(info, MimeTypes.VIDEO_DOLBY_VISION)) continue
            val levels = runCatching { info.getCapabilitiesForType(MimeTypes.VIDEO_DOLBY_VISION).profileLevels }
                .getOrNull() ?: continue
            for (level in levels) add(Integer.numberOfTrailingZeros(level.profile))
        }
    }

    @Suppress("DEPRECATION")
    private fun displayHdrTypes(context: Context): Set<Int> {
        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
            ?: return emptySet()
        val types = if (Build.VERSION.SDK_INT >= 34) {
            display.mode.supportedHdrTypes
        } else {
            display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
        }
        return types.toSet()
    }
}
```

- [ ] **Step 3: 编译**

Run: `./gradlew :app:compileDebugKotlin -x packServer`
Expected: `BUILD SUCCESSFUL`。若 `AudioCapabilities.getCapabilities` 的签名与 1.11.1 不符，按编译器提示的重载调整（同样取「默认音频属性、不指定路由设备」的那个）。

- [ ] **Step 4: 自审**：`getCapabilitiesForType` 对不支持的类型会抛，已 `runCatching`；`display.mode` 在 API 34+ 非空；位运算注释与 Android `MediaCodecInfo.CodecProfileLevel` 常量一致（DolbyVisionProfileDvheStn=0x20，DvheSt=0x100）。
- [ ] **Step 5: 独立评审**：派只读 subagent 审 `CapabilitiesProbe.kt`（重点：API 级别分支、异常、缓存线程安全）。
- [ ] **Step 6: 提交**：未授权，跳过。

---

### Task 6: 播放器工厂、统计与轨道适配

**Files:**

- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayerFactory.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/StatsCollector.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/TrackAdapter.kt`

**Interfaces:**

- Consumes: `toVideoInfo`（Task 5）、`TrackDescriptor`、`audioLabel`、`subtitleLabel`、`EXTERNAL_ID_PREFIX`（Task 4）。
- Produces:
  - `object PlayerFactory { fun create(context: Context, http: DataSource.Factory, seekMs: Long): ExoPlayer }`
  - `data class StatsSnapshot(val video: VideoInfo? = null, val videoDecoder: String? = null, val audioDecoder: String? = null, val audioMime: String? = null, val bitrateKbps: Int = 0, val droppedFrames: Int = 0)`
  - `class StatsCollector : AnalyticsListener { var snapshot: StatsSnapshot; fun reset() }`
  - `data class TrackOption(val group: Tracks.Group, val trackIndex: Int, val label: String, val selected: Boolean)`
  - `fun Tracks.options(trackType: Int): List<TrackOption>`
  - `fun Tracks.selectedVideo(): VideoInfo?`
  - `fun Player.select(option: TrackOption)`、`fun Player.disableTrackType(trackType: Int)`

- [ ] **Step 1: 写 `PlayerFactory.kt`**

```kotlin
package com.yingbox.android.playback.engine

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * 创建播放器。解码器策略：平台（硬件）解码器优先，初始化失败自动换下一个，
 * 都不行才用扩展解码器（ffmpeg 音频软解）。音频直通（Atmos、TrueHD、DTS-HD）由 ExoPlayer 的音频输出
 * 按设备和 HDMI 能力自动选择，不用额外开关。
 */
@OptIn(UnstableApi::class)
object PlayerFactory {
    fun create(context: Context, http: DataSource.Factory, seekMs: Long): ExoPlayer {
        val renderers = DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)
        return ExoPlayer.Builder(context, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(seekMs)
            .setSeekForwardIncrementMs(seekMs)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
            .apply { videoChangeFrameRateStrategy = C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS }
    }
}
```

- [ ] **Step 2: 写 `StatsCollector.kt`**

```kotlin
package com.yingbox.android.playback.engine

import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.analytics.AnalyticsListener

/** 一刻的播放统计（统计浮层由子项目 C 绘制） */
data class StatsSnapshot(
    val video: VideoInfo? = null,
    val videoDecoder: String? = null,
    val audioDecoder: String? = null,
    val audioMime: String? = null,
    val bitrateKbps: Int = 0,
    val droppedFrames: Int = 0,
)

/** 收集解码器名、码率、丢帧；读 [snapshot] 的 Compose 会随更新重组。 */
@OptIn(UnstableApi::class)
class StatsCollector : AnalyticsListener {
    var snapshot by mutableStateOf(StatsSnapshot())
        private set

    /** 换了一集或换源时清零 */
    fun reset() {
        snapshot = StatsSnapshot()
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        snapshot = snapshot.copy(video = format.toVideoInfo())
    }

    override fun onAudioInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        snapshot = snapshot.copy(audioMime = format.sampleMimeType)
    }

    override fun onVideoDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        snapshot = snapshot.copy(videoDecoder = decoderName)
    }

    override fun onAudioDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        snapshot = snapshot.copy(audioDecoder = decoderName)
    }

    override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
        snapshot = snapshot.copy(droppedFrames = snapshot.droppedFrames + droppedFrames)
    }

    override fun onBandwidthEstimate(
        eventTime: AnalyticsListener.EventTime,
        totalLoadTimeMs: Int,
        totalBytesLoaded: Long,
        bitrateEstimate: Long,
    ) {
        snapshot = snapshot.copy(bitrateKbps = (bitrateEstimate / 1000).toInt())
    }
}
```

- [ ] **Step 3: 写 `TrackAdapter.kt`**

```kotlin
package com.yingbox.android.playback.engine

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks

/** 界面里的一条可选轨道 */
data class TrackOption(
    val group: Tracks.Group,
    val trackIndex: Int,
    val label: String,
    val selected: Boolean,
)

/** 某类轨道（[C.TRACK_TYPE_AUDIO] 或 [C.TRACK_TYPE_TEXT]）里设备能放的全部选项 */
fun Tracks.options(trackType: Int): List<TrackOption> = buildList {
    for (group in groups) {
        if (group.type != trackType) continue
        for (i in 0 until group.length) {
            if (!group.isTrackSupported(i)) continue
            val f = group.getTrackFormat(i)
            val d = TrackDescriptor(
                language = f.language,
                label = f.label,
                mimeType = f.sampleMimeType,
                channels = f.channelCount,
                external = f.id?.startsWith(EXTERNAL_ID_PREFIX) == true,
                selected = group.isTrackSelected(i),
            )
            val label = if (trackType == C.TRACK_TYPE_AUDIO) audioLabel(d) else subtitleLabel(d)
            add(TrackOption(group, i, label, d.selected))
        }
    }
}

/** 当前正在播的那一路视频；没有为 null */
fun Tracks.selectedVideo(): VideoInfo? {
    for (group in groups) {
        if (group.type != C.TRACK_TYPE_VIDEO) continue
        for (i in 0 until group.length) {
            if (group.isTrackSelected(i)) return group.getTrackFormat(i).toVideoInfo()
        }
    }
    return null
}

/** 切到某条轨道（同时取消该类轨道的禁用，字幕被关掉后再选能直接显示） */
fun Player.select(option: TrackOption) {
    trackSelectionParameters = trackSelectionParameters.buildUpon()
        .setTrackTypeDisabled(option.group.type, false)
        .setOverrideForType(TrackSelectionOverride(option.group.mediaTrackGroup, option.trackIndex))
        .build()
}

/** 关掉某类轨道（关字幕） */
fun Player.disableTrackType(trackType: Int) {
    trackSelectionParameters = trackSelectionParameters.buildUpon()
        .setTrackTypeDisabled(trackType, true)
        .build()
}
```

- [ ] **Step 4: 编译**

Run: `./gradlew :app:compileDebugKotlin -x packServer`
Expected: `BUILD SUCCESSFUL`。若 `AnalyticsListener` 的某个回调签名与 1.11.1 不符（例如 `onBandwidthEstimate` 参数名或 `DecoderReuseEvaluation` 可空性），以编译器报错的签名为准改，保持含义不变。

- [ ] **Step 5: 自审**：`Tracks.Group.mediaTrackGroup` 与 `TrackSelectionOverride(group, index)` 用法；`Player.select` 只改一类轨道；`StatsCollector` 状态只在主线程回调里写（ExoPlayer 默认应用线程）。
- [ ] **Step 6: 独立评审**：只读 subagent 审三个文件，重点：`AnalyticsListener` 回调线程、轨道覆盖用法、解码器兜底配置。
- [ ] **Step 7: 提交**：未授权，跳过。

---

### Task 7: PlayerScreen 接入内核

**Files:**

- Modify: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerScreen.kt`

**Interfaces:**

- Consumes: `PlayerFactory.create`、`StatsCollector`（`snapshot`、`reset()`）、`CapabilitiesProbe.get`、`planVideo`、`notice`、`softwareAudioNotice`、`describeError`、`Tracks.selectedVideo`。
- Produces: 播放器屏幕顶部在杜比视界降级、P5 颜色风险、音频软解时显示 6 秒提示；播放出错文案带原因。

- [ ] **Step 1: 改 import**

删除（不再使用）：

```kotlin
import androidx.media3.common.AudioAttributes
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
```

新增：

```kotlin
import androidx.media3.common.Tracks
import com.yingbox.android.playback.engine.CapabilitiesProbe
import com.yingbox.android.playback.engine.PlayerFactory
import com.yingbox.android.playback.engine.StatsCollector
import com.yingbox.android.playback.engine.describeError
import com.yingbox.android.playback.engine.notice
import com.yingbox.android.playback.engine.planVideo
import com.yingbox.android.playback.engine.selectedVideo
import com.yingbox.android.playback.engine.softwareAudioNotice
```

（保持文件原有 import 的字母顺序。）

- [ ] **Step 2: 替换播放器构造**

把

```kotlin
    val player = remember {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            // 代理要先取上游（DNS、SSRF 校验、上游响应），默认 8 秒对慢源太短
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(mapOf("Authorization" to client.authorization))
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(SEEK_MS)
            .setSeekForwardIncrementMs(SEEK_MS)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
    }
```

替换为

```kotlin
    val stats = remember { StatsCollector() }
    val caps = remember { CapabilitiesProbe.get(context) }
    var videoNotice by remember { mutableStateOf<String?>(null) }
    val player = remember {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            // 代理要先取上游（DNS、SSRF 校验、上游响应），默认 8 秒对慢源太短
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(mapOf("Authorization" to client.authorization))
        PlayerFactory.create(context, http, SEEK_MS).also { it.addAnalyticsListener(stats) }
    }
```

- [ ] **Step 3: 开播前清统计和提示**

在 `LaunchedEffect(index, sourceNo)` 里 `error = null` 之后加两行：

```kotlin
        stats.reset()
        videoNotice = null
```

- [ ] **Step 4: 在监听器里按轨道出提示、错误带原因**

在 `DisposableEffect` 的 `object : Player.Listener` 里，`onIsPlayingChanged` 之前加：

```kotlin
            override fun onTracksChanged(tracks: Tracks) {
                val video = tracks.selectedVideo() ?: return
                val plan = planVideo(video, caps)
                Log.i(TAG, "视频 $video，方案 $plan")
                videoNotice = plan.notice()
            }
```

把 `onPlayerError` 里

```kotlin
                if (!switchSource("播放出错")) error = "播放出错：${e.errorCodeName}，换个源试试"
```

替换为

```kotlin
                if (!switchSource("播放出错")) error = "${describeError(e.errorCode, e.errorCodeName)}，换个源试试"
```

- [ ] **Step 5: 显示提示**

在 `focus` 定义之前加：

```kotlin
    // 视频降级与音频软解的提示合成一条，出现后 6 秒自动消失
    val snapshot = stats.snapshot
    val noticeText = listOfNotNull(videoNotice, softwareAudioNotice(snapshot.audioDecoder, snapshot.audioMime))
        .joinToString("\n")
        .ifEmpty { null }
    var noticeShown by remember { mutableStateOf(false) }
    LaunchedEffect(noticeText) {
        noticeShown = noticeText != null
        if (noticeText != null) {
            delay(6_000)
            noticeShown = false
        }
    }
```

在 `error?.let { … }` 之后、`Box` 内追加：

```kotlin
        if (noticeShown) {
            noticeText?.let {
                Text(
                    it,
                    color = YbColor.TextPrimary,
                    fontSize = YbText.Md,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(YbSpace.S4)
                        .ybGlass(YbRadius.Lg, media = true)
                        .padding(YbSpace.S4),
                )
            }
        }
```

- [ ] **Step 6: 编译与单元测试**

Run: `./gradlew :app:compileDebugKotlin :app:testDebugUnitTest -x packServer`
Expected: `BUILD SUCCESSFUL`，无 `Unresolved reference`，全部单元测试通过。

- [ ] **Step 7: 真机/模拟器验证（基础链路）**

在仓库根目录：`pnpm build:android`（模拟器加 `--abi x86_64`），然后：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.yingbox.android/.MainActivity
adb logcat -s YingboxPlayer
```

进入任意在线片源开播。Expected：日志有 `设备能力：Capabilities(…)` 和 `视频 VideoInfo(…)，方案 Direct`；播放不退化；断网或换一个坏源时错误文案带具体原因。

- [ ] **Step 8: 自审**：核对 `switchSource`、续播、进度上报逻辑一字未动；`stats` 监听器随 `player.release()` 一起释放；`videoNotice` 在换集时清空。
- [ ] **Step 9: 独立评审**：改行为，派只读 subagent 审 `PlayerScreen.kt` 差异，使用 requesting-code-review；范围含与换源、续播的交互。发现问题修复后复审。
- [ ] **Step 10: 提交**：未授权，跳过。

---

### Task 8: ffmpeg 音频软解（可行性验证加接入）

**Files:**

- Modify: `android/gradle/libs.versions.toml`
- Modify: `android/app/build.gradle.kts`
- Modify: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayerFactory.kt`（加一行可用性日志）

**背景：** media3 官方不发布 ffmpeg 解码扩展的 Maven 包，只能自编或用社区包。Maven Central 上有 Jellyfin 的 `org.jellyfin.media3:media3-ffmpeg-decoder`，2026-11-03 查到的最新版是 `1.9.0+1`，而本项目是 media3 1.11.1，**二进制兼容性未知，这是本任务要验证的**。dav1d（AV1 软解）没有任何 Maven 包，需自编 NDK，本计划不做，AV1 靠设备硬解；有需要另起计划。

**Interfaces:**

- Consumes: `PlayerFactory.create`（Task 6）。扩展渲染器由 `DefaultRenderersFactory` 在 `EXTENSION_RENDERER_MODE_ON` 下按类名反射加载，不需要改调用方。
- Produces: 设备不支持的音频格式（DTS、TrueHD 等）改用软解；日志可见 `ffmpeg=true`。

- [ ] **Step 1: 加依赖**

`libs.versions.toml`：`[versions]` 加 `jellyfinFfmpeg = "1.9.0+1"`，`[libraries]` 加：

```toml
jellyfin-media3-ffmpeg = { module = "org.jellyfin.media3:media3-ffmpeg-decoder", version.ref = "jellyfinFfmpeg" }
```

`build.gradle.kts` 的 `dependencies` 里 `media3.ui` 之后加：

```kotlin
    implementation(libs.jellyfin.media3.ffmpeg)
```

- [ ] **Step 2: 加可用性日志**

`PlayerFactory.kt` 顶部 import 增加 `android.util.Log` 与 `androidx.media3.decoder.ffmpeg.FfmpegLibrary`；在 `create` 函数 `val renderers = …` 之前加：

```kotlin
        Log.i("YingboxPlayer", "ffmpeg 音频软解可用：${FfmpegLibrary.isAvailable()}，支持 DTS：${FfmpegLibrary.supportsFormat("audio/vnd.dts")}")
```

- [ ] **Step 3: 编译**

Run: `./gradlew :app:compileDebugKotlin -x packServer`
Expected: `BUILD SUCCESSFUL`。

- [ ] **Step 4: 运行验证**

同 Task 7 Step 7 的安装与 logcat，开播任意片源。
Expected：日志有 `ffmpeg 音频软解可用：true，支持 DTS：true`，且播放正常、无 `NoSuchMethodError` / `AbstractMethodError`。

- [ ] **Step 5: 分支处理**
  - **通过**：继续 Step 6。
  - **崩溃或 `isAvailable()` 为 false**：撤销 Step 1–2 的改动，改为按 media3 仓库 `libraries/decoder_ffmpeg/README.md`，在 WSL 里用 1.11.1 对应的 tag 自编 AAR，放到 `android/app/libs/`，build.gradle.kts 改 `implementation(files("libs/media3-decoder-ffmpeg.aar"))`，再回到 Step 3。若自编也不通，音频软解后置，在 Task 9 的 ADR 里写明原因，本计划其余任务不受影响。

- [ ] **Step 6: 测量 APK 增量**

Run: `ls -l android/app/build/outputs/apk/debug/app-debug.apk`，与接入前对比（接入前的大小在 Task 7 Step 7 构建后记录）。发布包只拆 `arm64-v8a` 与 `x86_64`，实际增量以 `pnpm build:android` 发布配置为准。把增量记入 Task 9 的 ADR。

- [ ] **Step 7: 真机检查（有 DTS 样片时）**

用 `ffmpeg -f lavfi -i sine=frequency=440:duration=10 -c:a dca -strict -2 -b:a 768k dts.mka` 生成 DTS 样片；等 B1（连 NAS）完成后放到片库播放。Expected：音频有声，播放器顶部出现「本设备不支持 DTS，已改用软解」。此步在 B1 之前无法端到端执行，记入 Task 9 的检查清单。

- [ ] **Step 8: 自审**；Step 9: 独立评审（范围：依赖版本、`FfmpegLibrary` 调用、回退分支）；Step 10: 提交，未授权，跳过。

---

### Task 9: ADR 与文档

**Files:**

- Create: `docs/adr/0038-android-player-core.md`
- Modify: `AGENTS.md`（ADR 索引，第 160 行末尾）
- Modify: `android/README.md`（「现状」补一段，新增「播放内核真机检查清单」）

- [ ] **Step 1: 写 ADR**

`docs/adr/0038-android-player-core.md`，格式同 ADR-0032（日期、状态、相关、背景、决策、后果、否决方案）：

```markdown
# ADR-0038 安卓播放内核：能力探测、决策表、解码器兜底

- 日期：2026-11-03
- 状态：已采纳
- 相关：ADR-0028（安卓端方案）、ADR-0032（选源与播放）、ADR-0017（桌面杜比视界重建）

## 背景

安卓播放器此前直接构造 ExoPlayer，没有杜比视界、HDR 处理，没有扩展解码器，也没有轨道模型。NAS 片源里的 DV（P5、P7、P8）、DTS、TrueHD 在不同设备上表现不一。

## 决策

1. **能力探测，不堆软解。** `playback/engine` 启动时探测一次：硬件 DV 解码器支持的 profile、屏幕 HDR、AV1 硬解、音频直通；结果缓存。
2. **一个决策表。** `planVideo` 只看（视频 DV profile，设备能力）：设备有对应 DV 解码器 → 原样；P7 / P8 无解码器 → HEVC 基础层，按屏幕能力显示 HDR10 或 SDR；P5 无解码器 → 提示颜色可能不正确（子项目 D 再做服务端重建）。
3. **解码器策略。** 平台解码器优先（`EXTENSION_RENDERER_MODE_ON`），初始化失败自动换下一个，扩展解码器兜底；音频直通交给 ExoPlayer 的音频输出按设备能力自动选择。
4. **音频软解用 ffmpeg 扩展**（来源与版本见「后果」），视频软解不做。
5. **轨道、统计、错误中文映射**各自一个纯函数或薄适配，界面（子项目 C）直接消费。

## 后果

- （Task 8 完成后填写：ffmpeg 来源、版本、APK 增量、是否验证通过。）
- AV1 软解（dav1d）没有 Maven 包，需自编 NDK，本期不做；无 AV1 硬解的设备放不了 AV1。
- 软解 4K 在低端盒子上会卡，所以只对音频软解。
- ffmpeg 为 LGPL，随 APK 的第三方声明需包含它。

## 否决方案

- **视频软解兜底 DV**：性能不够，且没有 DV 元数据处理，结果还是偏色。
- **自己实现音频直通开关**：ExoPlayer 已按 HDMI 能力自动选择，再加开关只会和设备能力冲突。
```

Task 8 完成后，把「后果」第一条替换为实际结论（版本号、APK 增量、通过或回退方案）。

- [ ] **Step 2: 更新 ADR 索引**

`AGENTS.md` 第 160 行末尾，在 `[0037](docs/adr/0037-android-release-and-update.md) 安卓发布与更新` 之后追加：

```
; [0038](docs/adr/0038-android-player-core.md) 安卓播放内核：能力探测与解码兜底
```

- [ ] **Step 3: 更新 `android/README.md`**

在「现状」段末尾追加：

```markdown
播放内核（ADR-0038）：`playback/engine` 负责能力探测、杜比视界决策、解码器兜底、轨道模型和统计；播放器屏幕只管界面和进度。

### 播放内核真机检查清单

在目标设备上逐项过，每项看顶部提示、`adb logcat -s YingboxPlayer` 的「设备能力」与「视频 … 方案 …」日志：

- DV P8（HDR10 兼容）：有 DV 解码器的设备走 DV；没有的显示 HDR10 或 SDR，颜色正常
- DV P5：没有 DV 解码器的设备顶部提示颜色可能不正确
- DV P7（蓝光双层）：能播基础层，不黑屏
- Atmos（EAC3-JOC）、TrueHD：接功放的设备直通；不接的正常下混
- DTS：平台不支持的设备顶部提示「已改用软解」且有声
- AV1：有硬解的设备流畅；没有的给出可读的错误原因
- 24p 片源：电视切到 24Hz，无明显换帧卡顿
```

- [ ] **Step 4: 检查 diff**：文档类改动，只看 diff；确认 ADR 索引一行、README 两段。
- [ ] **Step 5: 提交**：未授权，跳过。

---

## 自检结论

- **规格覆盖：** 能力探测（Task 5）、`PlayerFactory`（Task 6）、`VideoInfo`（Task 1）、`TrackModel`（Task 4、6）、`Stats`（Task 6）、`PlayDecision`（Task 2、4）、`PlayerScreen` 接入（Task 7）、错误处理（Task 3、7）、软解与风险（Task 8）、测试与真机清单（各任务、Task 9）均有对应。
- **与规格的差异（需用户知晓）：** AV1 软解（dav1d）本期不做，原因是没有 Maven 包、要自编 NDK，规格「风险」一节已允许后置；HDR10+ 只记录在 `Capabilities.displayHdr10Plus`，片源侧无法从轨道格式识别，所以不进 `HdrKind`。
- **一致性：** `Capabilities`、`VideoInfo`、`HdrKind`、`TrackDescriptor`、`StatsSnapshot` 的字段名在各任务间一致；`softwareAudioNotice` 在 Task 4 定义、Task 7 使用。
