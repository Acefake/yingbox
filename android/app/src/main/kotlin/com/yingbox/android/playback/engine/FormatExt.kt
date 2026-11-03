package com.yingbox.android.playback.engine

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi

/** 播放器的视频格式 → [VideoInfo] */
@OptIn(UnstableApi::class)
fun Format.toVideoInfo(): VideoInfo =
    videoInfo(width, height, codecs, colorInfo?.colorTransfer ?: Format.NO_VALUE)
