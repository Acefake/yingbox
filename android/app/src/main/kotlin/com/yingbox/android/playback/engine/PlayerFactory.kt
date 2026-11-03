package com.yingbox.android.playback.engine

import android.content.Context
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

private const val TAG = "YingboxPlayer"

/**
 * 创建播放器。解码器策略：平台（硬件）解码器优先，初始化失败自动换下一个，
 * 都不行才用扩展解码器（ffmpeg 音频软解）。音频直通（Atmos、TrueHD、DTS-HD）由 ExoPlayer 的音频输出
 * 按设备和 HDMI 能力自动选择，不用额外开关。
 *
 * ffmpeg 扩展是社区预编译包，与 media3 小版本不一定二进制兼容：扩展加载失败时退回不带扩展的播放器，
 * 只是没有音频软解，不能让所有片源都放不了。
 */
@OptIn(UnstableApi::class)
object PlayerFactory {
    fun create(context: Context, http: DataSource.Factory, seekMs: Long): ExoPlayer =
        try {
            Log.i(TAG, "ffmpeg 音频软解可用：${FfmpegLibrary.isAvailable()}，支持 DTS：${FfmpegLibrary.supportsFormat("audio/vnd.dts")}")
            build(context, http, seekMs, DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
        } catch (e: RuntimeException) {
            Log.w(TAG, "ffmpeg 扩展加载失败，不带音频软解", e)
            build(context, http, seekMs, DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
        } catch (e: LinkageError) {
            Log.w(TAG, "ffmpeg 扩展与 media3 不兼容，不带音频软解", e)
            build(context, http, seekMs, DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
        }

    private fun build(context: Context, http: DataSource.Factory, seekMs: Long, extensionMode: Int): ExoPlayer {
        val renderers = DefaultRenderersFactory(context)
            .setExtensionRendererMode(extensionMode)
            .setEnableDecoderFallback(true)
        return ExoPlayer.Builder(context, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(seekMs)
            .setSeekForwardIncrementMs(seekMs)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
            .apply { videoChangeFrameRateStrategy = C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS }
    }
}
