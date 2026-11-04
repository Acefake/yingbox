package com.yingbox.android.playback.engine

import android.content.Context
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil

/** null 表示没有完成查询；支持仅指解码器声明可处理已知格式，不证明显示输出。 */
data class DecoderSupport(val native: Boolean? = null, val baseLayer: Boolean? = null)

/** 使用与 Media3 播放相同的格式支持检查，包含已知的 profile、level、尺寸和帧率。 */
@OptIn(UnstableApi::class)
fun queryDecoderSupport(context: Context, format: Format): DecoderSupport {
    val mime = format.sampleMimeType ?: return DecoderSupport()
    if (format.drmInitData != null || format.width <= 0 || format.height <= 0) return DecoderSupport()
    return try {
        val candidates = MediaCodecUtil.getDecoderInfosSoftMatch(MediaCodecSelector.DEFAULT, format, false, false)
        val supported = candidates.filter { it.isFormatSupported(context, format) }
        DecoderSupport(
            native = supported.any { it.mimeType == mime && (mime != MimeTypes.VIDEO_DOLBY_VISION || it.hardwareAccelerated) },
            baseLayer = supported.any { it.mimeType != mime },
        )
    } catch (error: MediaCodecUtil.DecoderQueryException) {
        Log.w("YingboxPlayer", "视频解码能力查询失败", error)
        DecoderSupport()
    } catch (error: RuntimeException) {
        Log.w("YingboxPlayer", "设备未能完成视频格式检查", error)
        DecoderSupport()
    }
}
