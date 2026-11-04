package com.yingbox.android.playback.engine

import kotlin.math.pow

/**
 * 画质增强档位，与桌面端、网页端 player.enhance 同名同义。
 * [rcasStops] 是 FSR RCAS 的锐化档（stops，0 最锐，越大越柔），[strength] = 2^-stops 交给着色器。
 */
enum class EnhanceLevel(val key: String, val label: String, private val rcasStops: Float) {
    Off("off", "关闭", 2f),
    Soft("soft", "柔和", 1.2f),
    Standard("standard", "标准", 0.6f),
    Strong("strong", "强", 0.25f);

    val strength: Float get() = 2f.pow(-rcasStops)

    companion object {
        fun fromKey(key: String?): EnhanceLevel = entries.firstOrNull { it.key == key } ?: Off
    }
}

/** 实际要做的增强：用 EASU 放大到 [targetHeight]（为空表示不放大），再用 RCAS 按 [strength] 锐化。 */
data class EnhancePlan(val targetHeight: Int?, val strength: Float)

/** EASU 的输出尺寸：高度为 [targetHeight]，宽度按原比例取偶数。 */
fun easuOutputSize(width: Int, height: Int, targetHeight: Int): Pair<Int, Int> {
    val w = (width.toLong() * targetHeight / height.coerceAtLeast(1)).toInt()
    return (w + w % 2).coerceAtLeast(2) to targetHeight
}

/** 放大目标的上限，避免 GPU 在 4K 以上白白耗电 */
private const val MAX_TARGET_HEIGHT = 2160

/**
 * 色彩传输信息缺失的片源（常见的 H.264 mp4）：8 位或 H.264 实际都是 SDR，可以增强；
 * 其余编码（HEVC / AV1 / VP9 等，可能是没标元数据的 HDR）仍保持原生路径。
 */
private fun looksSdr(video: VideoInfo): Boolean =
    video.hdr == HdrKind.Sdr ||
        (video.hdr == HdrKind.Unknown && (video.bitDepth == 8 || video.codecs?.startsWith("avc", ignoreCase = true) == true))

/**
 * 只对 SDR 启用；HDR、杜比视界和无法判断的色彩保持原生路径。
 * 片源低于屏幕高度才放大，否则只做锐化。
 */
fun enhancePlan(level: EnhanceLevel, video: VideoInfo?, displayHeight: Int): EnhancePlan? {
    if (level == EnhanceLevel.Off || video == null) return null
    if (!looksSdr(video) || video.dv != null) return null
    if (video.width <= 0 || video.height <= 0 || displayHeight <= 0) return null
    val target = displayHeight.coerceAtMost(MAX_TARGET_HEIGHT)
    return EnhancePlan(if (video.height < target) target else null, level.strength)
}
