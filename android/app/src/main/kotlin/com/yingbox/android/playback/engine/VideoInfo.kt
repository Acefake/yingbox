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

/** 一路视频的规格（纯数据，由 [toVideoInfo] 从播放器格式转来） */
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
