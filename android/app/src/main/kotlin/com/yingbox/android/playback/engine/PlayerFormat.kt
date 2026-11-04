package com.yingbox.android.playback.engine

import java.util.Locale

/** 倍速的档位 */
val SPEED_STEPS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)

/** 「1×」「0.75×」 */
fun speedLabel(speed: Float): String = (if (speed == speed.toInt().toFloat()) speed.toInt().toString() else speed.toString()) + "×"

/** 播放时间：不到一小时是 `02:03`，一小时以上是 `1:02:03`；未知（负数，含 media3 的 TIME_UNSET）显示 `--:--` */
fun formatClock(ms: Long): String {
    if (ms < 0) return "--:--"
    val total = ms / 1000
    val hours = total / 3600
    val minutes = total % 3600 / 60
    val seconds = total % 60
    return if (hours > 0) String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds) else String.format(Locale.ROOT, "%02d:%02d", minutes, seconds)
}

/** 竖直滑动 [dragPx]（向下为正）换算成调节量：滑过整个高度 [heightPx] 对应 1，向上滑为正 */
fun gestureDelta(dragPx: Float, heightPx: Float): Float = if (heightPx <= 0f) 0f else -dragPx / heightPx
