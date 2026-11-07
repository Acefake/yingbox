package com.yingbox.android.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.media.AudioManager
import android.provider.Settings
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import com.yingbox.android.playback.engine.formatClock
import com.yingbox.android.playback.engine.gestureDelta
import com.yingbox.android.playback.engine.scrubTarget
import com.yingbox.android.playback.engine.speedLabel
import kotlin.math.abs
import kotlin.math.roundToInt

/** 长按时的倍速 */
private const val BOOST_SPEED = 2f

internal fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/**
 * 触屏手势：单击显示 / 隐藏控制层，双击左 / 右半屏快退 / 快进，长按两倍速（松手恢复），
 * 横滑拖进度（松手才跳转，时长未知时不响应），左半屏上下滑调亮度、右半屏上下滑调音量。
 * 调节结果交给 [onHud] 显示（画在控制层上面）。
 */
@Composable
internal fun PlayerGestures(
    state: PlayerState,
    scrubber: Scrubber,
    onTap: () -> Unit,
    onHud: (String) -> Unit,
    onScrubbing: (Boolean) -> Unit,
) {
    val player = state.player
    val context = LocalContext.current
    val window = remember { context.activity()?.window }
    val audio = remember { context.getSystemService(AudioManager::class.java) }
    // 窗口亮度是 -1（跟随系统）时取系统当前亮度，免得第一次滑动就跳到别的值
    val systemBrightness = remember {
        runCatching { Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrDefault(0.5f)
    }
    var brightness by remember {
        mutableFloatStateOf(window?.attributes?.screenBrightness?.takeIf { it >= 0 } ?: systemBrightness)
    }
    var brightnessChanged by remember { mutableStateOf(false) }
    fun currentVolume(): Float =
        audio?.let { it.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / it.getStreamMaxVolume(AudioManager.STREAM_MUSIC) } ?: 0.5f
    var volume by remember { mutableFloatStateOf(currentVolume()) }
    // 退出播放时把亮度还给系统（只在这里调过亮度时）
    DisposableEffect(window) {
        onDispose {
            if (brightnessChanged) window?.let { it.attributes = it.attributes.apply { screenBrightness = -1f } }
        }
    }
    var boostedFrom by remember { mutableStateOf<Float?>(null) }
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { offset ->
                        if (offset.x < size.width / 2) {
                            player.seekBack()
                            onHud("-10 秒")
                        } else {
                            player.seekForward()
                            onHud("+10 秒")
                        }
                    },
                    onLongPress = {
                        boostedFrom = state.speed
                        player.setPlaybackSpeed(BOOST_SPEED)
                        onHud(speedLabel(BOOST_SPEED))
                    },
                    onPress = {
                        tryAwaitRelease()
                        boostedFrom?.let { player.setPlaybackSpeed(it) }
                        boostedFrom = null
                    },
                )
            }
            .pointerInput(scrubber) {
                var startX = 0f
                var startPosition = 0L
                var active = false
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        startX = offset.x
                        startPosition = player.currentPosition
                        // 时长未知（直播等）时 scrubber 不接受拖动，也不要把控制层钉住
                        active = player.duration > 0
                        if (active) {
                            scrubber.begin(startPosition)
                            onScrubbing(true)
                        }
                    },
                    onHorizontalDrag = { change, _ ->
                        if (!active) return@detectHorizontalDragGestures
                        change.consume()
                        scrubber.dragTo(scrubTarget(startPosition, change.position.x - startX, size.width.toFloat(), player.duration))
                        scrubber.target?.let {
                            val sign = if (it >= startPosition) "+" else "-"
                            onHud("${formatClock(it)}  ($sign${formatClock(abs(it - startPosition))})")
                        }
                    },
                    onDragEnd = {
                        if (active) {
                            scrubber.commit()
                            onScrubbing(false)
                        }
                        active = false
                    },
                    onDragCancel = {
                        if (active) {
                            scrubber.cancel()
                            onScrubbing(false)
                        }
                        active = false
                    },
                )
            }
            .pointerInput(Unit) {
                var fromLeft = true
                detectVerticalDragGestures(
                    onDragStart = {
                        fromLeft = it.x < size.width / 2
                        // 用实体音量键调过之后，从当前音量开始滑
                        volume = currentVolume()
                    },
                    onVerticalDrag = { change, dy ->
                        change.consume()
                        val delta = gestureDelta(dy, size.height.toFloat())
                        if (fromLeft) {
                            brightness = (brightness + delta).coerceIn(0.02f, 1f)
                            window?.let { it.attributes = it.attributes.apply { screenBrightness = brightness } }
                            brightnessChanged = true
                            onHud("亮度 ${(brightness * 100).roundToInt()}%")
                        } else if (audio != null) {
                            volume = (volume + delta).coerceIn(0f, 1f)
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, (volume * audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).roundToInt(), 0)
                            onHud("音量 ${(volume * 100).roundToInt()}%")
                        }
                    },
                )
            },
    )
}
