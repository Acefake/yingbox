# 安卓手机与电视播放器控制层重构 Implementation Plan

> **执行方式：** 按已确认方式使用 executing-plans；已授权子代理执行时使用 subagent-driven-development。仅要求写计划不授权实现。步骤使用复选框。

**Goal:** 重做安卓手机与电视播放界面的控制层，手机按 Infuse iOS、电视按 Infuse tvOS 的交互习惯，播放内核不动。

**Architecture:** 控制层拆成 `ui/player/` 下职责单一的小文件：共用的纯函数（遥控器键位、长按加速、横滑换算）放 `playback/engine/` 并配 JVM 单测；`PlayerHost` 只负责画面、手机/电视分流和系统行为，分别组装 `PhoneOverlay` 与 `TvOverlay`；选项数据（字幕、音轨、倍速、比例）手机电视共用一份。`PlayerState` 仍是唯一状态来源。

**Tech Stack:** Kotlin、Jetpack Compose、media3 ExoPlayer、JUnit4（`:app:testDebugUnitTest`）、Gradle（`android/gradlew.bat`）。

**验证与授权：** 纯函数用 TDD（先写失败测试）；Compose 布局、手势、焦点没有自动化测试（仓库只有 JVM 单测，见 ADR-0041），用编译、JVM 测试、在 `yb_test`（手机）与 `yb_tv`（电视）模拟器实际操作加截图验证，并写明局限。验证档位：跨模块的功能改动，按模块跑测试，不跑全仓库。**尚未授权提交**：每个任务末尾的提交步骤只在你明确说“提交”后执行。

## Global Constraints

- 播放内核不动：`PlayerState`、`playback/engine/` 里的解码、轨道、增强、诊断逻辑、续播与进度上报一行不改（只新增文件，`TrackAdapter.kt` 等只调用不修改）。
- `PlayerHost(state, title, onPrevious, onNext, onBack)` 的签名不变，`PlayerScreen.kt` 与 `LibraryPlayerScreen.kt` 不改调用方式。
- 新文件放 `android/app/src/main/kotlin/com/yingbox/android/ui/player/`，包名仍是 `com.yingbox.android.ui`（不改 import）；纯函数放 `android/app/src/main/kotlin/com/yingbox/android/playback/engine/`，包名 `com.yingbox.android.playback.engine`。
- 保持横屏沉浸（ADR-0041 第 7 条）：`PlayerFullscreen(landscape)` 继续使用。
- 样式只用 `Theme.kt` 的令牌（`YbColor`、`YbText`、`YbRadius`、`YbSpace`），玻璃用 `Modifier.ybGlass(shape, media = true)`，不写裸颜色（纯黑 `Color.Black`、白色 `Color.White` 用于画面背景与播放钮除外）。
- 电视布局（`LocalIsTv.current == true`）不出现任何必须触摸才能用的元素；每个可点元素用 `focusFrame` 以便遥控器聚焦并有高亮。
- 自动隐藏：手机 4 秒无操作隐藏；暂停、拖进度、浮层或面板打开时不隐藏。
- 文案全部简体中文；注释说明为什么，不复述代码。
- 单文件 ≤ 400 行（仓库约定）。
- 常用命令（在仓库根目录 `C:\Users\10228\OneDrive\桌面\项目\yingbox` 下）：
  - JVM 单测：`cd android && .\gradlew.bat :app:testDebugUnitTest --tests "com.yingbox.android.playback.engine.PlayerControlTest"`
  - 编译：`cd android && .\gradlew.bat :app:compileDebugKotlin`
  - 出包：`cd android && .\gradlew.bat :app:assembleDebug`，APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`
  - 装机：`adb -s emulator-5554 install -r -d <apk>`（手机），`adb -s emulator-5556 install -r -d <apk>`（电视）；`adb` 在 `%LOCALAPPDATA%\Android\Sdk\platform-tools`，每条命令前加 `timeout`。
  - 模拟器若没开：用 PowerShell `Start-Process ... -WindowStyle Hidden` 启动 `emulator -avd yb_test` 与 `emulator -avd yb_tv -port 5556`（从 Bash 后台脚本里起，脚本结束会连带杀掉）。

---

### Task 1: 播放控制纯函数（键位、长按加速、横滑换算）

**Files:**
- Create: `android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayerControl.kt`
- Test: `android/app/src/test/kotlin/com/yingbox/android/playback/engine/PlayerControlTest.kt`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `enum class RemoteMode { Hidden, Controls, Panel }`
  - `enum class RemoteKey { Left, Right, Up, Down, Center, Back }`
  - `sealed interface RemoteAction`：`object TogglePlay`、`object ShowControls`、`object OpenPanel`、`object ClosePanel`、`object HideControls`、`object Exit`、`data class SeekStep(val direction: Int)`（direction 为 -1 / 1）、`object None`
  - `fun remoteAction(key: RemoteKey, mode: RemoteMode): RemoteAction`
  - `fun remoteSeekStep(pressCount: Int): Long`：第 n 次连发的步长（毫秒）
  - `fun scrubTarget(startMs: Long, dragPx: Float, widthPx: Float, durationMs: Long): Long`

- [ ] **Step 1: 写失败的测试**

```kotlin
package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerControlTest {
    @Test fun `隐藏时：确定暂停，上唤出，下开面板，左右拖进度，返回退出`() {
        assertEquals(RemoteAction.TogglePlay, remoteAction(RemoteKey.Center, RemoteMode.Hidden))
        assertEquals(RemoteAction.ShowControls, remoteAction(RemoteKey.Up, RemoteMode.Hidden))
        assertEquals(RemoteAction.OpenPanel, remoteAction(RemoteKey.Down, RemoteMode.Hidden))
        assertEquals(RemoteAction.SeekStep(-1), remoteAction(RemoteKey.Left, RemoteMode.Hidden))
        assertEquals(RemoteAction.SeekStep(1), remoteAction(RemoteKey.Right, RemoteMode.Hidden))
        assertEquals(RemoteAction.Exit, remoteAction(RemoteKey.Back, RemoteMode.Hidden))
    }

    @Test fun `控制层显示时：方向键交给焦点，返回先收起`() {
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Left, RemoteMode.Controls))
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Center, RemoteMode.Controls))
        assertEquals(RemoteAction.HideControls, remoteAction(RemoteKey.Back, RemoteMode.Controls))
    }

    @Test fun `面板打开时：返回关面板，其余键交给焦点`() {
        assertEquals(RemoteAction.ClosePanel, remoteAction(RemoteKey.Back, RemoteMode.Panel))
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Down, RemoteMode.Panel))
    }

    @Test fun `长按连发步长逐级加速并封顶`() {
        assertEquals(10_000L, remoteSeekStep(1))
        assertEquals(10_000L, remoteSeekStep(3))
        assertEquals(30_000L, remoteSeekStep(4))
        assertEquals(60_000L, remoteSeekStep(8))
        assertEquals(300_000L, remoteSeekStep(14))
        assertEquals(300_000L, remoteSeekStep(500))
        assertEquals(10_000L, remoteSeekStep(0))
    }

    @Test fun `横滑换算：整屏宽度对应整部片的四分之一，限制在片内`() {
        // 90 分钟的片，横滑整屏 = 22.5 分钟
        val dur = 5_400_000L
        assertEquals(600_000L + 675_000L, scrubTarget(600_000L, 400f, 800f, dur))
        assertEquals(0L, scrubTarget(60_000L, -800f, 800f, dur))
        assertEquals(dur, scrubTarget(dur - 1_000L, 800f, 800f, dur))
    }

    @Test fun `横滑换算：时长未知或宽度为零时保持原位`() {
        assertEquals(1_000L, scrubTarget(1_000L, 300f, 800f, -1L))
        assertEquals(1_000L, scrubTarget(1_000L, 300f, 0f, 5_000L))
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && .\gradlew.bat :app:testDebugUnitTest --tests "com.yingbox.android.playback.engine.PlayerControlTest"`
Expected: 编译失败，`Unresolved reference: remoteAction`（及 `RemoteMode` 等）。

- [ ] **Step 3: 写最小实现**

实现：

```kotlin
package com.yingbox.android.playback.engine

/** 电视遥控器当前所处的界面状态：控制层隐藏（播放中）、控制层显示、选项面板打开 */
enum class RemoteMode { Hidden, Controls, Panel }

/** 本播放器关心的遥控器键 */
enum class RemoteKey { Left, Right, Up, Down, Center, Back }

/** 一个遥控器键在当前状态下要做的事；[None] 表示交给焦点所在的组件自己处理 */
sealed interface RemoteAction {
    data object TogglePlay : RemoteAction
    data object ShowControls : RemoteAction
    data object OpenPanel : RemoteAction
    data object ClosePanel : RemoteAction
    data object HideControls : RemoteAction
    data object Exit : RemoteAction
    /** 拖进度一步：[direction] 为 -1（后退）或 1（前进） */
    data class SeekStep(val direction: Int) : RemoteAction
    data object None : RemoteAction
}

/**
 * 遥控器键位表：同一个键在同一状态下只有一种含义。
 * 控制层显示或面板打开时，方向键与确定键交给焦点所在的按钮，只有返回键由这里处理。
 */
fun remoteAction(key: RemoteKey, mode: RemoteMode): RemoteAction = when (mode) {
    RemoteMode.Hidden -> when (key) {
        RemoteKey.Center -> RemoteAction.TogglePlay
        RemoteKey.Up -> RemoteAction.ShowControls
        RemoteKey.Down -> RemoteAction.OpenPanel
        RemoteKey.Left -> RemoteAction.SeekStep(-1)
        RemoteKey.Right -> RemoteAction.SeekStep(1)
        RemoteKey.Back -> RemoteAction.Exit
    }
    RemoteMode.Controls -> if (key == RemoteKey.Back) RemoteAction.HideControls else RemoteAction.None
    RemoteMode.Panel -> if (key == RemoteKey.Back) RemoteAction.ClosePanel else RemoteAction.None
}

/** 按住左右键连发时，第 [pressCount] 次（从 1 起）的步长：前 3 次 10 秒，之后逐级加到 5 分钟封顶 */
fun remoteSeekStep(pressCount: Int): Long = when {
    pressCount <= 3 -> 10_000L
    pressCount <= 7 -> 30_000L
    pressCount <= 13 -> 60_000L
    else -> 300_000L
}

/** 手机横滑拖进度：横滑整屏宽度对应整部片的四分之一，结果限制在 0..[durationMs]；时长未知或宽度为 0 时保持 [startMs] */
fun scrubTarget(startMs: Long, dragPx: Float, widthPx: Float, durationMs: Long): Long {
    if (durationMs <= 0 || widthPx <= 0f) return startMs
    val delta = (dragPx / widthPx * durationMs / 4).toLong()
    return (startMs + delta).coerceIn(0L, durationMs)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd android && .\gradlew.bat :app:testDebugUnitTest --tests "com.yingbox.android.playback.engine.PlayerControlTest"`
Expected: 6 个测试全部 PASS（用例名带反引号，Gradle 输出里是原名）。

- [ ] **Step 5: 交付前自审**

按 code-style 审阅本任务完整差异：键位表是否穷尽、步长边界（0、3/4、7/8、13/14）、`scrubTarget` 的取整与钳制；记录结论。

- [ ] **Step 6: 独立评审**

不需要：纯函数、改动小、测试覆盖边界（档位：小改动）。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add android/app/src/main/kotlin/com/yingbox/android/playback/engine/PlayerControl.kt android/app/src/test/kotlin/com/yingbox/android/playback/engine/PlayerControlTest.kt
git commit -m "feat(android): 播放控制纯函数（遥控器键位、长按加速、横滑换算）"
```

---

### Task 2: 拖进度状态 `Scrubber` 与选项数据 `OptionLists`

**Files:**
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/Scrubber.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/OptionLists.kt`
- Test: `android/app/src/test/kotlin/com/yingbox/android/ui/ScrubberTest.kt`

**Interfaces:**
- Consumes: `scrubTarget`、`remoteSeekStep`（Task 1）；`SPEED_STEPS`、`speedLabel`（已有）；`TrackOption`、`Tracks.options`、`Player.select`、`Player.disableTrackType`（`TrackAdapter.kt`）。
- Produces:
  - `class Scrubber(private val durationMs: () -> Long, private val seekTo: (Long) -> Unit)`：属性 `target: Long?`（拖动中的目标，未拖动为 null）；方法 `begin(positionMs: Long)`、`dragTo(targetMs: Long)`、`step(direction: Int, pressCount: Int)`（遥控器加速步进，基于当前 target）、`commit()`（有 target 才 `seekTo` 并清空）、`cancel()`。
  - `data class OptionItem(val label: String, val selected: Boolean, val enabled: Boolean = true, val onSelect: () -> Unit)`
  - `data class OptionGroup(val title: String, val items: List<OptionItem>)`
  - `@Composable fun rememberOptionGroups(state: PlayerState): List<OptionGroup>`：顺序固定为 字幕、音轨、倍速、比例；字幕组第一项是“关”；没有可选轨道时该组只有一个不可选的“无”。

- [ ] **Step 1: 写失败的测试（Scrubber）**

```kotlin
package com.yingbox.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScrubberTest {
    private val sought = mutableListOf<Long>()
    private fun scrubber(duration: Long = 600_000L) = Scrubber({ duration }) { sought += it }

    @Test fun `拖动期间只记目标，commit 才真正跳转`() {
        val s = scrubber()
        s.begin(100_000L)
        s.dragTo(250_000L)
        assertEquals(250_000L, s.target)
        assertEquals(emptyList<Long>(), sought)
        s.commit()
        assertEquals(listOf(250_000L), sought)
        assertNull(s.target)
    }

    @Test fun `没拖动就 commit 不跳转`() {
        val s = scrubber()
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }

    @Test fun `遥控器连发在目标上累加并限制在片内`() {
        val s = scrubber(duration = 100_000L)
        s.begin(50_000L)
        s.step(1, 1)
        s.step(1, 2)
        assertEquals(70_000L, s.target)
        repeat(20) { s.step(1, 14) }
        assertEquals(100_000L, s.target)
        repeat(20) { s.step(-1, 14) }
        assertEquals(0L, s.target)
    }

    @Test fun `时长未知时不能拖`() {
        val s = scrubber(duration = -1L)
        s.begin(1_000L)
        s.dragTo(5_000L)
        s.step(1, 1)
        assertNull(s.target)
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }

    @Test fun `cancel 丢弃目标`() {
        val s = scrubber()
        s.begin(1_000L)
        s.dragTo(9_000L)
        s.cancel()
        assertNull(s.target)
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && .\gradlew.bat :app:testDebugUnitTest --tests "com.yingbox.android.ui.ScrubberTest"`
Expected: 编译失败，`Unresolved reference: Scrubber`。

- [ ] **Step 3: 写实现**

`Scrubber.kt`：

```kotlin
package com.yingbox.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.yingbox.android.playback.engine.remoteSeekStep

/**
 * 拖进度的共用状态：手指横滑、拖进度条、遥控器连发都只改这里的目标时间，
 * 松手（[commit]）才真正跳转，避免每一帧都 seek，也避免滑块先弹回旧位置。
 * 时长未知（直播等）时不接受任何拖动。
 */
class Scrubber(private val durationMs: () -> Long, private val seekTo: (Long) -> Unit) {
    /** 拖动中的目标位置（毫秒）；没在拖为 null。Compose 状态，界面据此显示目标时间 */
    var target by mutableStateOf<Long?>(null)
        private set

    private fun draggable() = durationMs() > 0

    fun begin(positionMs: Long) {
        if (draggable()) target = positionMs.coerceIn(0L, durationMs())
    }

    fun dragTo(targetMs: Long) {
        if (draggable()) target = targetMs.coerceIn(0L, durationMs())
    }

    /** 遥控器一步：[direction] 为 -1 / 1，[pressCount] 是连发的第几次，步长见 [remoteSeekStep] */
    fun step(direction: Int, pressCount: Int) {
        val base = target ?: return
        dragTo(base + direction * remoteSeekStep(pressCount))
    }

    fun commit() {
        val t = target ?: return
        target = null
        seekTo(t)
    }

    fun cancel() {
        target = null
    }
}
```

注意：`ScrubberTest` 用 `Scrubber(...)` 在 JVM 里创建；`mutableStateOf` 在纯 JVM 单测里可用（Compose runtime 不依赖 Android）。若运行报缺依赖，则把 `target` 改成普通 `var target: Long? = null; private set`，界面里用 `remember` 包一个 `mutableLongStateOf` 做镜像（在 Step 4 前就地决定并说明）。

`OptionLists.kt`：

```kotlin
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yingbox.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.media3.common.C
import androidx.media3.ui.AspectRatioFrameLayout
import com.yingbox.android.playback.engine.SPEED_STEPS
import com.yingbox.android.playback.engine.disableTrackType
import com.yingbox.android.playback.engine.options
import com.yingbox.android.playback.engine.select
import com.yingbox.android.playback.engine.speedLabel

/** 一个可选的值：手机浮层和电视面板都用它画 */
data class OptionItem(val label: String, val selected: Boolean, val enabled: Boolean = true, val onSelect: () -> Unit)

/** 一组选项：字幕、音轨、倍速或画面比例 */
data class OptionGroup(val title: String, val items: List<OptionItem>)

private val RESIZE_MODES = listOf(
    "适应" to AspectRatioFrameLayout.RESIZE_MODE_FIT,
    "填充" to AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
    "拉伸" to AspectRatioFrameLayout.RESIZE_MODE_FILL,
)

/**
 * 播放选项（字幕、音轨、倍速、画面比例），手机顶部浮层和电视底部面板共用同一份数据与选择逻辑。
 * 读取 [PlayerState] 的状态，所以选项变化会触发重组。
 */
@Composable
fun rememberOptionGroups(state: PlayerState): List<OptionGroup> {
    val player = state.player
    val text = state.tracks.options(C.TRACK_TYPE_TEXT)
    val audio = state.tracks.options(C.TRACK_TYPE_AUDIO)
    val subtitleOff = C.TRACK_TYPE_TEXT in player.trackSelectionParameters.disabledTrackTypes || text.none { it.selected }
    val none = listOf(OptionItem("无", selected = false, enabled = false, onSelect = {}))
    return remember(state.tracks, state.speed, state.resizeMode, subtitleOff) {
        listOf(
            OptionGroup(
                "字幕",
                if (text.isEmpty()) none else listOf(OptionItem("关", subtitleOff) { player.disableTrackType(C.TRACK_TYPE_TEXT) }) +
                    text.map { o -> OptionItem(o.label, o.selected && !subtitleOff) { player.select(o) } },
            ),
            OptionGroup("音轨", if (audio.isEmpty()) none else audio.map { o -> OptionItem(o.label, o.selected) { player.select(o) } }),
            OptionGroup("倍速", SPEED_STEPS.map { s -> OptionItem(speedLabel(s), state.speed == s) { player.setPlaybackSpeed(s) } }),
            OptionGroup("比例", RESIZE_MODES.map { (label, mode) -> OptionItem(label, state.resizeMode == mode) { state.resizeMode = mode } }),
        )
    }
}
```

- [ ] **Step 4: 运行测试与编译**

Run: `cd android && .\gradlew.bat :app:testDebugUnitTest --tests "com.yingbox.android.ui.ScrubberTest" && .\gradlew.bat :app:compileDebugKotlin`
Expected: 5 个测试 PASS，`BUILD SUCCESSFUL`。

- [ ] **Step 5: 交付前自审**

审阅 `Scrubber` 的边界（时长未知、越界、先 step 后 begin 的无效调用）和 `rememberOptionGroups` 的 remember 键是否漏了会变化的输入（`player.trackSelectionParameters` 的变化通过 `subtitleOff` 体现）；记录结论。

- [ ] **Step 6: 独立评审**

不需要：新增文件、不接入界面、有单测（档位：小改动）。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add android/app/src/main/kotlin/com/yingbox/android/ui/player android/app/src/test/kotlin/com/yingbox/android/ui
git commit -m "feat(android): 拖进度状态与手机电视共用的播放选项数据"
```

---

### Task 3: 手机控制层（顶栏图标浮层、中间三钮、底部进度）与横滑拖进度

**Files:**
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/PhoneOverlay.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/PhoneOptionsPopup.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/PlayerGestures.kt`（把现有 `PlayerGestures` 与 `Context.activity()` 从 `PlayerControls.kt` 迁来，并加横滑）
- Modify: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerHost.kt`（本任务先让手机走新控制层，电视仍走旧的；Task 5 统一收尾）

**Interfaces:**
- Consumes: `Scrubber`、`OptionGroup`、`rememberOptionGroups`（Task 2）；`scrubTarget`（Task 1）；`PlayerState`、`PlayerIcons`、`GlassIconButton`、`ybGlass`、`focusFrame`、`YbColor/YbText/YbRadius/YbSpace`、`formatClock`、`gestureDelta`、`speedLabel`。
- Produces:
  - `@Composable internal fun PhoneOverlay(state: PlayerState, title: String, subtitle: String?, onPrevious: (() -> Unit)?, onNext: (() -> Unit)?, scrubber: Scrubber, onActivity: () -> Unit, onScrubbing: (Boolean) -> Unit, onBack: () -> Unit)`
  - `@Composable internal fun PhoneOptionsPopup(group: OptionGroup, onClose: () -> Unit)`
  - `@Composable internal fun PlayerGestures(state: PlayerState, scrubber: Scrubber, onTap: () -> Unit, onHud: (String) -> Unit, onScrubbing: (Boolean) -> Unit)`
  - `internal fun Context.activity(): Activity?`（从旧文件迁来，内容不变）

- [ ] **Step 1: 迁出手势并加横滑**

把 `PlayerControls.kt` 里 `Context.activity()` 与 `PlayerGestures` 整体剪到 `ui/player/PlayerGestures.kt`，签名按上面的 Produces 改。在原 `detectVerticalDragGestures` 之前加一个横向手势：

```kotlin
.pointerInput(scrubber) {
    var startX = 0f
    var startPosition = 0L
    detectHorizontalDragGestures(
        onDragStart = { offset ->
            startX = offset.x
            startPosition = player.currentPosition
            scrubber.begin(startPosition)
            onScrubbing(true)
        },
        onHorizontalDrag = { change, _ ->
            change.consume()
            val duration = player.duration
            scrubber.dragTo(scrubTarget(startPosition, change.position.x - startX, size.width.toFloat(), duration))
            scrubber.target?.let { onHud("${formatClock(it)}  (${if (it >= startPosition) "+" else "-"}${formatClock(kotlin.math.abs(it - startPosition))})") }
        },
        onDragEnd = { scrubber.commit(); onScrubbing(false) },
        onDragCancel = { scrubber.cancel(); onScrubbing(false) },
    )
}
```

需要 `import androidx.compose.foundation.gestures.detectHorizontalDragGestures` 与 `com.yingbox.android.playback.engine.scrubTarget`。亮度与音量的 HUD 文案保持原样（边缘竖条放 Task 6 的打磨项，不在本任务做）。

- [ ] **Step 2: 写 `PhoneOptionsPopup`**

```kotlin
package com.yingbox.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup

/** 手机顶部图标点开的小浮层：一组选项，选完立刻关闭 */
@Composable
internal fun PhoneOptionsPopup(group: OptionGroup, onClose: () -> Unit) {
    Popup(onDismissRequest = onClose) {
        Column(
            Modifier.widthIn(min = 160.dp, max = 260.dp).ybGlass(YbRadius.Card, media = true).padding(YbSpace.S2),
        ) {
            Text(group.title, color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.padding(YbSpace.S2))
            for (item in group.items) {
                Text(
                    (if (item.selected) "✓ " else "   ") + item.label,
                    color = if (item.enabled) YbColor.TextPrimary else YbColor.TextTertiary,
                    fontSize = YbText.Md,
                    modifier = Modifier.focusFrame(onClick = { if (item.enabled) { item.onSelect(); onClose() } }).padding(YbSpace.S3),
                )
            }
        }
    }
}
```

`focusFrame` 的实际签名以 `Ui.kt:155` 为准：先读该函数，把 `shape` 等必填参数补齐（此处 `onClick` 命名参数沿用 `PlayerControls.kt` 里 `TransportButton` 的调用方式）。

- [ ] **Step 3: 写 `PhoneOverlay`**

布局规则（Compose 代码按此写，复用旧 `PlayerControls.kt` 的 `TransportButton` 并迁到本文件）：

```kotlin
@Composable
internal fun PhoneOverlay(
    state: PlayerState, title: String, subtitle: String?,
    onPrevious: (() -> Unit)?, onNext: (() -> Unit)?,
    scrubber: Scrubber, onActivity: () -> Unit, onScrubbing: (Boolean) -> Unit, onBack: () -> Unit,
) {
    val player = state.player
    val groups = rememberOptionGroups(state)
    var openGroup by remember { mutableStateOf<OptionGroup?>(null) }
    var position by remember { mutableLongStateOf(player.currentPosition) }
    var duration by remember { mutableLongStateOf(player.duration) }
    LaunchedEffect(player) { while (true) { position = player.currentPosition; duration = player.duration; delay(500L) } }
    Box(Modifier.fillMaxSize()) {
        // 顶栏：返回钮 + 两行标题 + 右侧图标（字幕、音轨、倍速、比例、画质增强）
        Row(Modifier.align(Alignment.TopStart).fillMaxWidth().statusBarsPadding().displayCutoutPadding()
            .padding(horizontal = gutter(), vertical = YbSpace.S3), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            GlassIconButton(YbIcons.Back, "返回", media = true, onClick = onBack)
            Column(Modifier.weight(1f)) {
                Text(title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Text(subtitle, color = YbColor.TextSecondary, fontSize = YbText.Sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            for (group in groups) GlassIconButton(iconFor(group.title), group.title, media = true) { openGroup = group; onActivity() }
            GlassIconButton(PlayerIcons.Enhance, "画质增强", media = true) { state.toggleEnhance(); onActivity() }
        }
        // 中间三钮
        Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(YbSpace.S8), verticalAlignment = Alignment.CenterVertically) {
            TransportButton(PlayerIcons.Replay10, "快退 10 秒", size = 56.dp) { player.seekBack(); onActivity() }
            TransportButton(if (state.playWhenReady) PlayerIcons.Pause else YbIcons.Play, if (state.playWhenReady) "暂停" else "播放", big = true, size = 72.dp) {
                if (state.playWhenReady) player.pause() else player.play(); onActivity()
            }
            TransportButton(PlayerIcons.Forward10, "快进 10 秒", size = 56.dp) { player.seekForward(); onActivity() }
        }
        // 底部：渐变压暗 + 进度条（复用 Slider，值来自 scrubber.target ?: position）+ 两端时间与上一集 / 下一集
        PhoneBottomBar(Modifier.align(Alignment.BottomCenter), state, scrubber, position, duration, onPrevious, onNext, onActivity, onScrubbing)
        openGroup?.let { PhoneOptionsPopup(it) { openGroup = null } }
    }
}
```

`iconFor(title)` 返回各组的图标：字幕 `YbIcons.Subtitles`、音轨 `YbIcons.Audio`、倍速 `PlayerIcons.Speed`、比例 `PlayerIcons.Fullscreen`；若 `YbIcons` 里没有对应图标，在 `PlayerIcons.kt` 里按现有 `icon("名字", "path")` 写法补手写矢量（Material 基础图形，Apache 2.0，沿用 ADR-0041 的做法）。

`PhoneBottomBar`：`Column`，背景 `Brush.verticalGradient(listOf(Color.Transparent, Color(0xB3000000)))`，`navigationBarsPadding()`、`displayCutoutPadding()`；一行 `Row`：`TransportButton(SkipPrevious, enabled = onPrevious != null)`（`onPrevious == null` 时整个不渲染）、`Text(formatClock(now))`、`Slider`（`value = shown`；`onValueChange = { scrubber.begin(position); scrubber.dragTo((it * duration).toLong()); onScrubbing(true); onActivity() }`；`onValueChangeFinished = { scrubber.commit(); onScrubbing(false) }`；`enabled = duration > 0`）、`Text("-" + formatClock(duration - now))`、`TransportButton(SkipNext)`。`shown`、`now` 都取 `scrubber.target ?: position`。Slider 的 colors、thumb、track 样式直接沿用旧 `PlayerControls.kt` 中的 `sliderColors` 与 `track` 写法。

- [ ] **Step 4: 在 `PlayerHost` 里让手机走新控制层**

`PlayerHost.kt`：创建 `val scrubber = remember(player) { Scrubber({ player.duration }, { player.seekTo(it); }) }`；`val isTv = LocalIsTv.current`；在 `AnimatedVisibility` 里 `if (!isTv) PhoneOverlay(...) else PlayerControls(...)`（电视暂时走旧的）；`PlayerGestures(...)` 换成新签名并传 `scrubber`、`onScrubbing = { scrubbing = it }`；手势拖动期间让 `touched` 刷新，保证不自动隐藏（`scrubbing` 已在自动隐藏的条件里）。副标题：先传 `null`（集名在后续任务里从 `PlayerScreen` 的参数获得，不在本任务做）。

- [ ] **Step 5: 编译、出包、手机模拟器验证**

Run: `cd android && .\gradlew.bat :app:compileDebugKotlin && .\gradlew.bat :app:assembleDebug`，再 `adb -s emulator-5554 install -r -d android\app\build\outputs\apk\debug\app-debug.apk`，打开应用播放一部 8-bit H.264 视频。
Expected: BUILD SUCCESSFUL；播放页顶部有返回钮与标题、右上 5 个图标，点字幕/音轨/倍速/比例各弹出小浮层且选完关闭；中间三个大圆钮可用；底部进度条拖动时松手才跳转；屏幕上横滑出现“目标时间”提示并在松手后跳转；单击显示/隐藏、双击快退快进、竖滑亮度音量仍可用。用 `adb -s emulator-5554 exec-out screencap -p > out\phone-player.png` 截图并查看。
局限：软件渲染模拟器上手势手感与真机不同，真机清单在 Task 6 更新。

- [ ] **Step 6: 交付前自审**

审阅完整差异：手势冲突（单击/双击/长按/横滑/竖滑互不抢）、`scrubbing` 期间不自动隐藏、`Popup` 在沉浸式下的位置、`onPrevious/onNext` 为空时不占位、时长未知时进度条禁用；记录结论与未解决风险。

- [ ] **Step 7: 独立评审**

需要：手势与状态联动，档位为功能改动。自审后派只读 subagent（`requesting-code-review` 模板），范围为 `ui/player/` 新文件、`PlayerHost.kt` 差异与直接调用方；评审不改文件、不跑测试；实现者修复后复审。

- [ ] **Step 8: 提交（仅在用户授权后）**

```bash
git add android/app/src/main/kotlin/com/yingbox/android/ui
git commit -m "feat(android): 手机播放控制层改为 Infuse 式布局并支持横滑拖进度"
```

---

### Task 4: 电视控制层、选项面板与遥控器键位

**Files:**
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/TvOverlay.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/TvOptionsPanel.kt`
- Create: `android/app/src/main/kotlin/com/yingbox/android/ui/player/RemoteKeys.kt`
- Modify: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerHost.kt`

**Interfaces:**
- Consumes: Task 1 的 `RemoteMode/RemoteKey/RemoteAction/remoteAction/remoteSeekStep`；Task 2 的 `Scrubber`、`OptionGroup`、`rememberOptionGroups`；Task 3 里迁到 `PhoneOverlay.kt` 之外共用的 `TransportButton`（本任务先把 `TransportButton` 从 `PhoneOverlay.kt` 抽到 `ui/player/TransportButton.kt`，两处共用）。
- Produces:
  - `internal fun Key.toRemoteKey(): RemoteKey?`（`Key.DirectionLeft` 等映射；`Key.DirectionCenter`、`Key.Enter`、`Key.MediaPlayPause` 都映射为 `Center`；`Key.Back`、`Key.Escape` 映射为 `Back`；其他返回 null）
  - `@Composable internal fun TvOverlay(state: PlayerState, title: String, subtitle: String?, onPrevious: (() -> Unit)?, onNext: (() -> Unit)?, scrubber: Scrubber, onActivity: () -> Unit, onBack: () -> Unit)`
  - `@Composable internal fun TvOptionsPanel(state: PlayerState, groups: List<OptionGroup>, onClose: () -> Unit)`

- [ ] **Step 1: 抽出 `TransportButton`**

把 `TransportButton` 与它依赖的 `focusFrame` 用法移到 `ui/player/TransportButton.kt`（`internal`），`PhoneOverlay.kt` 改为引用它。电视焦点高亮在这里加：当 `LocalIsTv.current` 且获得焦点时 `scale(1.18f)` 并加白色 2.dp 外圈（通过 `onFocusChanged` 记录 `focused`，`Modifier.graphicsLayer { scaleX = s; scaleY = s }`，`s` 用 `animateFloatAsState`）。

- [ ] **Step 2: 写 `RemoteKeys.kt`**

```kotlin
package com.yingbox.android.ui

import androidx.compose.ui.input.key.Key
import com.yingbox.android.playback.engine.RemoteKey

/** Compose 的按键映射到播放器关心的遥控器键；不关心的键返回 null，交给系统或焦点处理 */
internal fun Key.toRemoteKey(): RemoteKey? = when (this) {
    Key.DirectionLeft -> RemoteKey.Left
    Key.DirectionRight -> RemoteKey.Right
    Key.DirectionUp -> RemoteKey.Up
    Key.DirectionDown -> RemoteKey.Down
    Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.MediaPlayPause -> RemoteKey.Center
    Key.Back, Key.Escape -> RemoteKey.Back
    else -> null
}
```

- [ ] **Step 3: 写 `TvOverlay` 与 `TvOptionsPanel`**

`TvOverlay`：顶部左侧标题（两行）；中间无按钮；底部一条渐变区：进度条（电视上不用 `Slider`，自绘一个 6.dp 高的 `Box` 条 + 当前位置圆点，`scrubber.target ?: position` 决定位置）、左右时间；进度条下面一行按钮：上一集、快退 10 秒、播放/暂停（默认焦点）、快进 10 秒、下一集、选项（打开面板）。`LaunchedEffect(Unit) { playFocus.requestFocus() }`，让焦点默认在播放/暂停。`onPrevious/onNext` 为空时不渲染对应按钮。进度条本身是一个 `focusFrame` 目标：获得焦点时左右键调用 `scrubber.begin(position)`（首次）与 `scrubber.step(±1, n)`，`onKeyEvent` 里用 `event.nativeKeyEvent.repeatCount + 1` 作为 `pressCount`，松开 `KeyUp` 或停 800 ms（`LaunchedEffect(scrubber.target)` 里 `delay(800)` 后 `scrubber.commit()`）时提交。

`TvOptionsPanel`：底部玻璃面板（`Modifier.ybGlass(YbRadius.Card, media = true)`），`Row` 四列，每列 `Column`：小标题 + 该组 `items`（每项一个 `focusFrame`，选中项前加“✓”）；列间左右由 Compose 默认焦点移动处理，列内上下同理；面板顶部一行显示片源格式信息，来源与旧顶栏徽标相同（`playbackBadges(state.stats.snapshot, ...)`：先读 `PlayerControls.kt` 里原来的徽标调用并原样迁来，字符串用 `joinToString("  ·  ")`）；选中任一项后调用 `onClose()`；打开时 `LaunchedEffect(Unit)` 把焦点送给当前选中的第一项；画质增强开关作为面板最后一列的一个选项。

- [ ] **Step 4: 在 `PlayerHost` 接入遥控器**

用 `remoteAction` 替换旧的 `onKeyEvent`：

```kotlin
val mode = when { sheetOpen -> RemoteMode.Panel; controlsVisible -> RemoteMode.Controls; else -> RemoteMode.Hidden }
var pressCount by remember { mutableIntStateOf(0) }
.onKeyEvent { event ->
    val key = event.key.toRemoteKey() ?: return@onKeyEvent false
    if (event.type == KeyEventType.KeyUp) {
        if (key == RemoteKey.Left || key == RemoteKey.Right) { scrubber.commit(); pressCount = 0 }
        return@onKeyEvent false
    }
    if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
    when (val action = remoteAction(key, mode)) {
        RemoteAction.TogglePlay -> { if (player.playWhenReady) player.pause() else player.play(); poke() }
        RemoteAction.ShowControls -> poke()
        RemoteAction.OpenPanel -> sheetOpen = true
        RemoteAction.ClosePanel -> sheetOpen = false
        RemoteAction.HideControls -> controlsVisible = false
        RemoteAction.Exit -> onBack()
        is RemoteAction.SeekStep -> {
            if (pressCount == 0) scrubber.begin(player.currentPosition)
            pressCount += 1
            scrubber.step(action.direction, pressCount)
            controlsVisible = true; touched = SystemClock.elapsedRealtime()
        }
        RemoteAction.None -> return@onKeyEvent false
    }
    true
}
```

电视时 `AnimatedVisibility` 里渲染 `TvOverlay`，`sheetOpen` 时渲染 `TvOptionsPanel`（`rememberOptionGroups(state)`）。隐藏态的拖进度：`scrubber.target` 不为 null 时在屏幕中央显示 `formatClock(target)`（复用 `hud` 文本位置）。返回键：`BackHandler` 已有，改为 `remoteAction(Back, mode)` 的结果（面板→关，控制层→收起，隐藏→退出）。

- [ ] **Step 5: 编译、出包、电视模拟器验证**

Run: `cd android && .\gradlew.bat :app:assembleDebug`，`adb -s emulator-5556 install -r -d android\app\build\outputs\apk\debug\app-debug.apk`。用 `adb -s emulator-5556 shell input keyevent KEYCODE_DPAD_RIGHT|KEYCODE_DPAD_DOWN|KEYCODE_DPAD_UP|KEYCODE_DPAD_CENTER|KEYCODE_BACK` 逐个验证。
Expected: 隐藏时 DPAD_CENTER 暂停并出控制层；DPAD_UP 出控制层；DPAD_DOWN 弹出选项面板（四列、焦点可见）；DPAD_RIGHT 连发（`adb shell input keyevent --longpress KEYCODE_DPAD_RIGHT`）屏幕中央目标时间逐级跳大步长，松开后才跳转；控制层显示时左右键在按钮间移动且焦点放大；BACK 依次：关面板 → 收起控制层 → 退出播放。截图 `adb -s emulator-5556 exec-out screencap -p > out\tv-player.png`。
局限：模拟器没有实体遥控器，长按加速靠 `--longpress` 近似；真机清单在 Task 6 更新。

- [ ] **Step 6: 交付前自审**

审阅：键位在三种模式下是否都与规格表一致、`KeyUp` 提交与 800 ms 超时是否会重复提交（`commit` 幂等）、焦点在面板关闭后是否回到根容器、`pressCount` 在其他键中断时是否清零；记录结论。

- [ ] **Step 7: 独立评审**

需要（遥控器状态机，功能改动档位）。方式同 Task 3 Step 7，范围为 `RemoteKeys.kt`、`TvOverlay.kt`、`TvOptionsPanel.kt` 与 `PlayerHost.kt` 的键盘部分。

- [ ] **Step 8: 提交（仅在用户授权后）**

```bash
git add android/app/src/main/kotlin/com/yingbox/android/ui
git commit -m "feat(android): 电视播放控制层、选项面板与遥控器键位重构"
```

---

### Task 5: `PlayerHost` 收尾：删除旧控制层，标题与集名

**Files:**
- Delete: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerControls.kt`
- Delete: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerSettingsSheet.kt`
- Modify: `android/app/src/main/kotlin/com/yingbox/android/ui/PlayerHost.kt`、`PlayerScreen.kt`、`LibraryPlayerScreen.kt`（仅在需要传集名时）

**Interfaces:**
- Consumes: Task 3、4 的 `PhoneOverlay`、`TvOverlay`、`TvOptionsPanel`。
- Produces: `PlayerHost(state, title, onPrevious, onNext, onBack, subtitle: String? = null)`：新增末尾可选参数，旧调用方不传也能编译。

- [ ] **Step 1: 迁走 `PlayerSettingsSheet` 里仍被用到的东西**

播放诊断（`showStats`、`copyPlaybackDiagnostics`、`playbackDiagnosticReport` 的展示）原来在设置面板里：把诊断展示与复制按钮并入 `TvOptionsPanel` 的最右列和 `PhoneOverlay` 的“信息”图标浮层（点开后显示诊断文本与“复制播放诊断”）。Run `Grep` 确认 `PlayerSettingsSheet`、`PlayerControls` 没有其他引用后再删文件。

- [ ] **Step 2: 删除旧文件，`PlayerHost` 只保留分流**

`PlayerHost.kt` 中去掉对 `PlayerControls` 与 `PlayerSettingsSheet` 的引用，`if (isTv) TvOverlay(...) else PhoneOverlay(...)`，`sheetOpen` 仅电视使用；`PlayerHost.kt` 保持 ≤ 400 行。

- [ ] **Step 3: 集名副标题**

`PlayerScreen.kt` 与 `LibraryPlayerScreen.kt` 中已有标题字符串；若标题形如“剧名 · 第3集”，在 `PlayerHost` 里按 ` · ` 拆成主标题与副标题，不新增数据来源：

```kotlin
val (mainTitle, subTitle) = remember(title) {
    title.split(" · ", limit = 2).let { it[0] to it.getOrNull(1) }
}
```

`subtitle` 参数非空时优先使用，否则用拆出来的。

- [ ] **Step 3b: 编译与回归**

Run: `cd android && .\gradlew.bat :app:testDebugUnitTest && .\gradlew.bat :app:assembleDebug`
Expected: 全部 JVM 单测 PASS（含原有 `playback/engine` 全套），APK 构建成功。

- [ ] **Step 4: 两个模拟器回归**

两个模拟器各装新包，各播放一部在线片和一部片库片：返回、上一集/下一集、换源、续播位置、杜比视界降级提示与错误文案位置、画质增强开关与对比、播放诊断展示与复制。
Expected: 功能与重构前一致，且控制层不遮挡降级提示。截图保存到 `out\`。

- [ ] **Step 5: 交付前自审**

审阅完整差异（删除是否遗漏引用、诊断入口是否都保留、`PlayerHost` 行数、两端行为一致性）；记录结论。

- [ ] **Step 6: 独立评审**

需要。范围为整个重构的最终差异（`ui/player/` 全部新文件 + `PlayerHost.kt` + 删除的两个文件）与 `PlayerScreen`、`LibraryPlayerScreen` 调用方；高风险点：状态联动、焦点、沉浸式、续播进度上报不被新控制层影响。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add -A android/app/src/main/kotlin/com/yingbox/android/ui
git commit -m "refactor(android): 播放页只保留新控制层，删除旧控制条与设置面板"
```

---

### Task 6: 文档（ADR-0056、检查清单）与最终验证

**Files:**
- Create: `docs/adr/0056-android-player-controls-redesign.md`
- Modify: `docs/adr/0041-android-player-controls.md`（状态改为“部分取代，见 ADR-0056”）
- Modify: `AGENTS.md`（ADR 索引加 0056 一行；索引行写在 0054/0055 之后，注意 `tests/dev-gates/context-budget.test.ts` 对 AGENTS.md 体积的预算，必要时按该文件里的写法加一条带日期与原因的预算记录）
- Modify: `android/README.md`（真机检查清单替换手势与遥控器部分）

**Interfaces:**
- Consumes: 规格 `docs/s-atlas/specs/2026-11-07-android-player-redesign-design.md`。
- Produces: 无代码接口。

- [ ] **Step 1: 写 ADR-0056**

按仓库 ADR 格式（背景 / 决策 / 后果 / 否决方案）：背景写现有控制层入口堆在底栏、电视键位含义随状态变化、缺少拖进度；决策照规格第 2、3、4 节的要点（手机布局与手势、电视键位表、共用选项数据与 `Scrubber`、纯函数）；后果写“不做：选集侧栏、章节、缩略图、字幕样式；手势与焦点仍只靠真机清单”；否决方案照规格第 8 节。ADR-0041 顶部状态改为“部分取代（控制层布局、遥控器键位），其余仍有效”。

- [ ] **Step 2: 更新检查清单**

`android/README.md` 加入手机清单：横滑拖进度、顶部图标浮层选值、中间三钮、底部进度与时间、上下一集显示规则、双击/长按/竖滑；电视清单：隐藏态五个键与返回、控制层焦点放大、长按左右加速、下键面板四列与格式信息、返回键三级。

- [ ] **Step 3: 跑 ADR 与预算相关测试**

Run: `pnpm vitest run tests/adr.test.ts tests/dev-gates`
Expected: PASS（`adr.test` 要求每篇 ADR 都列在 AGENTS.md 索引里，漏了会失败）。

- [ ] **Step 4: 最终验证**

`cd android && .\gradlew.bat :app:testDebugUnitTest && .\gradlew.bat :app:assembleDebug`，两个模拟器各装一次，按新检查清单走一遍并截图。
Expected: 单测与构建通过；清单每项在模拟器上有结果，写明哪些项只能在真机上确认（手势手感、遥控器实体键长按、HDR/杜比输出）。

- [ ] **Step 5: 交付前自审与说明**

对照规格第 1 节三条成功标准逐条核对并记录；列出未解决风险（真机手感、遥控器长按连发间隔、模拟器软件渲染）。

- [ ] **Step 6: 独立评审**

不需要：纯文档（档位：第 0 档，只看 diff）。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add docs/adr/0056-android-player-controls-redesign.md docs/adr/0041-android-player-controls.md AGENTS.md android/README.md tests
git commit -m "docs(android): ADR-0056 播放控制层重构与真机检查清单"
```
