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
