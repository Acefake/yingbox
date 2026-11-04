package com.yingbox.android.playback.engine

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities

private const val TAG = "YingboxPlayer"

/** 探测解码器、当前显示器 HDR 和音频直通能力；显示未知与 SDR 分开。 */
@OptIn(UnstableApi::class)
object CapabilitiesProbe {
    /** 读取指定显示器的当前能力；路由变化后重新调用。 */
    fun get(context: Context, displayId: Int = Display.DEFAULT_DISPLAY): Capabilities {
        val decoders = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        }.getOrElse {
            Log.w(TAG, "枚举解码器失败", it)
            emptyList()
        }
        val displayHdr = runCatching { displayHdrTypes(context, displayId) }.getOrElse {
            Log.w(TAG, "显示 HDR 探测失败", it)
            null
        }
        val audio = runCatching { AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null) }.getOrNull()
        val caps = Capabilities(
            dvProfiles = dvProfiles(decoders),
            displayHdr = buildSet {
                if (displayHdr?.contains(Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION) == true) add(HdrKind.DolbyVision)
                if (displayHdr?.contains(Display.HdrCapabilities.HDR_TYPE_HDR10) == true) add(HdrKind.Hdr10)
                if (displayHdr?.contains(Display.HdrCapabilities.HDR_TYPE_HLG) == true) add(HdrKind.Hlg)
            },
            displayHdr10Plus = displayHdr?.contains(Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS) == true,
            displayKnown = displayHdr != null,
            av1Hardware = decoders.any { hasType(it, MimeTypes.VIDEO_AV1) && isHardware(it) },
            passthroughAtmos = audio?.supportsEncoding(C.ENCODING_E_AC3_JOC) == true,
            passthroughTrueHd = audio?.supportsEncoding(C.ENCODING_DOLBY_TRUEHD) == true,
            passthroughDtsHd = audio?.supportsEncoding(C.ENCODING_DTS_HD) == true,
        )
        Log.i(TAG, "设备能力：$caps")
        return caps
    }

    private fun hasType(info: MediaCodecInfo, mime: String): Boolean =
        info.supportedTypes.any { it.equals(mime, ignoreCase = true) }

    private fun isHardware(info: MediaCodecInfo): Boolean =
        if (Build.VERSION.SDK_INT >= 29) {
            info.isHardwareAccelerated
        } else {
            !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")
        }

    /** DV profile 常量是按位的（DvheStn = 0x20 = profile 5，DvheSt = 0x100 = profile 8），末尾零的个数就是 profile 号 */
    private fun dvProfiles(decoders: List<MediaCodecInfo>): Set<Int> = buildSet {
        for (info in decoders) {
            if (!isHardware(info) || !hasType(info, MimeTypes.VIDEO_DOLBY_VISION)) continue
            val levels = runCatching { info.getCapabilitiesForType(MimeTypes.VIDEO_DOLBY_VISION).profileLevels }
                .getOrNull() ?: continue
            for (level in levels) add(Integer.numberOfTrailingZeros(level.profile))
        }
    }

    @Suppress("DEPRECATION")
    private fun displayHdrTypes(context: Context, displayId: Int): Set<Int>? {
        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(displayId)
            ?: return null
        val types = if (Build.VERSION.SDK_INT >= 34) {
            display.mode.supportedHdrTypes
        } else {
            display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
        }
        return types.toSet()
    }
}
