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

/** 探测设备的解码器、屏幕 HDR 和音频直通能力。结果缓存一次，探测失败的部分按「不支持」处理。 */
@OptIn(UnstableApi::class)
object CapabilitiesProbe {
    @Volatile
    private var cached: Capabilities? = null

    fun get(context: Context): Capabilities =
        cached ?: synchronized(this) {
            cached ?: probe(context.applicationContext).also { cached = it }
        }

    private fun probe(context: Context): Capabilities {
        val decoders = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        }.getOrElse {
            Log.w(TAG, "枚举解码器失败", it)
            emptyList()
        }
        val displayHdr = displayHdrTypes(context)
        val audio = runCatching { AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null) }.getOrNull()
        val caps = Capabilities(
            dvProfiles = dvProfiles(decoders),
            displayHdr = buildSet {
                if (Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in displayHdr) add(HdrKind.DolbyVision)
                if (Display.HdrCapabilities.HDR_TYPE_HDR10 in displayHdr) add(HdrKind.Hdr10)
                if (Display.HdrCapabilities.HDR_TYPE_HLG in displayHdr) add(HdrKind.Hlg)
            },
            displayHdr10Plus = Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in displayHdr,
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
            if (!hasType(info, MimeTypes.VIDEO_DOLBY_VISION)) continue
            val levels = runCatching { info.getCapabilitiesForType(MimeTypes.VIDEO_DOLBY_VISION).profileLevels }
                .getOrNull() ?: continue
            for (level in levels) add(Integer.numberOfTrailingZeros(level.profile))
        }
    }

    @Suppress("DEPRECATION")
    private fun displayHdrTypes(context: Context): Set<Int> {
        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
            ?: return emptySet()
        val types = if (Build.VERSION.SDK_INT >= 34) {
            display.mode.supportedHdrTypes
        } else {
            display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
        }
        return types.toSet()
    }
}
