package com.yingbox.android.playback.engine

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi

/** 播放器的视频格式 → [VideoInfo] */
@OptIn(UnstableApi::class)
fun Format.toVideoInfo(): VideoInfo {
    val info = videoInfo(width, height, codecs, colorInfo?.colorTransfer ?: Format.NO_VALUE)
    return info.copy(
        bitDepth = colorInfo?.lumaBitdepth?.takeIf { it > 0 },
        frameRate = frameRate.takeIf { it > 0 },
        hdr = if (sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION) HdrKind.DolbyVision else info.hdr,
    )
}
