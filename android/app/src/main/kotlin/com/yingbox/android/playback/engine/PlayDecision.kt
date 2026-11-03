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

/** 音频解码器是 ffmpeg 软解时的提示（平台解码器不提示）。 */
fun softwareAudioNotice(decoderName: String?, mimeType: String?): String? {
    if (decoderName == null || !decoderName.startsWith("ffmpeg", ignoreCase = true)) return null
    val codec = audioCodecName(mimeType) ?: "这种音频"
    return "本设备不支持 $codec，已改用软解"
}
