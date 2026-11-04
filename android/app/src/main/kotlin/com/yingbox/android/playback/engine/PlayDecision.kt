package com.yingbox.android.playback.engine

/** 本次显示与音频路由下的播放能力（探测见 [CapabilitiesProbe]）。 */
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
    /** false 表示显示探测失败，不能等同于已确认的 SDR 屏幕。 */
    val displayKnown: Boolean = true,
) {
    companion object {
        /** 未获得能力信息；显示未知不能等同于已确认的 SDR。 */
        val NONE = Capabilities(emptySet(), emptySet(), false, false, false, false, false, false)
    }
}

/** 这一路视频该怎么放 */
sealed interface VideoPlan {
    /** 可尝试原生播放，具体格式支持和最终显示模式仍由播放器与设备核验。 */
    data object Direct : VideoPlan

    /** 缺少基础层兼容信息，不能证明已经正确降级。 */
    data object CompatibilityUnknown : VideoPlan

    /** 解码器与显示器声明能处理兼容层，尚不证明实际采用了这条路径。 */
    data class BaseLayerCandidate(val hdr: HdrKind) : VideoPlan

    /** 当前格式没有查到可用解码器。 */
    data object DecoderUnsupported : VideoPlan

    /** 显示器未声明支持当前动态范围，系统是否映射尚未确认。 */
    data object DisplayMismatch : VideoPlan

    /** 片源或显示能力不足以判断。 */
    data object Unverified : VideoPlan

    /** P5 没有兼容基础层，设备又没有 DV 解码器，颜色会偏 */
    data object ColorRisk : VideoPlan
}

/** 判断动态范围兼容性，不执行转换，也不证明最终输出模式。 */
fun planVideo(video: VideoInfo, caps: Capabilities, support: DecoderSupport = DecoderSupport(), source: FileVideoProbe? = null): VideoPlan {
    if (video.hdr == HdrKind.Unknown || !caps.displayKnown) return VideoPlan.Unverified
    if (video.hdr == HdrKind.DolbyVision && video.dv == null) return VideoPlan.Unverified
    val dv = video.dv ?: return when (support.native) {
        null -> VideoPlan.Unverified
        false -> VideoPlan.DecoderUnsupported
        true -> if (video.hdr == HdrKind.Sdr || video.hdr in caps.displayHdr) VideoPlan.Direct else VideoPlan.DisplayMismatch
    }
    if (support.native == true && HdrKind.DolbyVision in caps.displayHdr) return VideoPlan.Direct
    if (support.native == null) return VideoPlan.Unverified
    val baseLayer = video.baseLayerOf(source)
    val noCompatibleLayer = source?.hdr == HdrKind.DolbyVision && source.dvProfile == dv.profile && source.dvCompat == 0
    if (support.native == false && (dv.profile == 5 || noCompatibleLayer)) return VideoPlan.ColorRisk
    if (baseLayer != null && support.baseLayer == true) {
        return if (baseLayer == HdrKind.Sdr || baseLayer in caps.displayHdr) VideoPlan.BaseLayerCandidate(baseLayer) else VideoPlan.DisplayMismatch
    }
    if (support.native == true) return VideoPlan.DisplayMismatch
    return when (support.baseLayer) {
        true -> VideoPlan.CompatibilityUnknown
        false -> VideoPlan.DecoderUnsupported
        null -> VideoPlan.Unverified
    }
}

/** 要给用户看的提示；原样解码时没有。 */
fun VideoPlan.notice(): String? = when (this) {
    VideoPlan.Direct -> null
    VideoPlan.CompatibilityUnknown -> "未发现对应的杜比视界解码器，兼容层播放尚未确认"
    is VideoPlan.BaseLayerCandidate -> "片源包含 ${hdr.label} 兼容层，实际回退输出尚未确认"
    VideoPlan.DecoderUnsupported -> "设备未声明支持此视频规格，可尝试较低清晰度或其他片源"
    VideoPlan.DisplayMismatch -> "显示设备未声明支持此动态范围，色调映射尚未确认"
    VideoPlan.Unverified -> null
    VideoPlan.ColorRisk -> "未找到可用的杜比视界解码路径，片源没有已确认的兼容层，颜色可能不正确"
}

/** 音频解码器是 ffmpeg 软解时的提示（平台解码器不提示）。 */
fun softwareAudioNotice(decoderName: String?, mimeType: String?): String? {
    if (decoderName == null || !decoderName.startsWith("ffmpeg", ignoreCase = true)) return null
    val codec = audioCodecName(mimeType) ?: "这种音频"
    return "本设备不支持 $codec，已改用软解"
}
