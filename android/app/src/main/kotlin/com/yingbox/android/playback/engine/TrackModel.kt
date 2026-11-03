package com.yingbox.android.playback.engine

import java.util.Locale

/** 一条音轨或字幕轨的描述（纯数据，由 [options] 从播放器轨道转来） */
data class TrackDescriptor(
    val language: String?,
    val label: String?,
    val mimeType: String?,
    val channels: Int,
    /** 外挂字幕（创建外挂字幕时轨道 id 用 [EXTERNAL_ID_PREFIX] 开头） */
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
