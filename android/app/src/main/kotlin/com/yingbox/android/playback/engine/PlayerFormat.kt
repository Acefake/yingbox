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

/** 音频里值得在徽标上标出来的格式（普通的 AAC、PCM 不标） */
private val BADGE_AUDIO = setOf("Atmos", "TrueHD", "DTS:X", "DTS-HD", "DTS", "EAC3", "AC3")

/**
 * 控制层顶栏的信息徽标，顺序是分辨率、动态范围、音频。
 * 分辨率按宽度分档：宽银幕片（3840×1608）也是 4K。
 */
fun playbackBadges(video: VideoInfo?, audioMime: String?): List<String> = buildList {
    if (video != null) {
        resolutionBadge(video)?.let(::add)
        when (video.hdr) {
            HdrKind.DolbyVision -> add(video.dv?.let { "杜比视界 P${it.profile}" } ?: "杜比视界")
            HdrKind.Hdr10 -> add("HDR10")
            HdrKind.Hlg -> add("HLG")
            HdrKind.Sdr -> Unit
            HdrKind.Unknown -> Unit
        }
    }
    audioCodecName(audioMime)?.takeIf { it in BADGE_AUDIO }?.let(::add)
}

private fun resolutionBadge(video: VideoInfo): String? = when {
    video.width <= 0 -> null
    video.width >= 3800 -> "4K"
    video.width >= 2500 -> "2K"
    video.width >= 1900 -> "1080p"
    video.width >= 1260 -> "720p"
    else -> "${video.height}p"
}

/** 竖直滑动 [dragPx]（向下为正）换算成调节量：滑过整个高度 [heightPx] 对应 1，向上滑为正 */
fun gestureDelta(dragPx: Float, heightPx: Float): Float = if (heightPx <= 0f) 0f else -dragPx / heightPx
