package com.yingbox.android.playback.engine

import android.content.Context

import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.analytics.AnalyticsListener

/** 一刻的播放统计（统计浮层由子项目 C 绘制） */
data class StatsSnapshot(
    val video: VideoInfo? = null,
    val sourceVideo: FileVideoProbe? = null,
    /** NAS 只探测第一条正片视频流；多视频轨时不能据此推断当前轨。 */
    val sourceProbeApplicable: Boolean = false,
    val decoderSupport: DecoderSupport = DecoderSupport(),
    val videoDecoder: String? = null,
    val audioDecoder: String? = null,
    val audioMime: String? = null,
    /** 带宽估计（不是视频码率） */
    val bandwidthKbps: Int = 0,
    val droppedFrames: Int = 0,
    val droppedFrameSampleMs: Long = 0,
)

/** 收集解码器名、码率、丢帧；读 [snapshot] 的 Compose 会随更新重组。 */
@OptIn(UnstableApi::class)
class StatsCollector(private val context: Context? = null) : AnalyticsListener {
    var snapshot by mutableStateOf(StatsSnapshot())
        private set

    /** 换了一集或换源时清零 */
    fun reset(sourceVideo: FileVideoProbe? = null) {
        snapshot = StatsSnapshot(sourceVideo = sourceVideo)
    }

    /** 移除被禁用或已离开的轨道信息，避免沿用上一条流的规格。 */
    fun clearMissingTracks(hasVideo: Boolean, hasAudio: Boolean, videoTrackCount: Int = 0) {
        snapshot = snapshot.copy(
            sourceProbeApplicable = hasVideo && videoTrackCount == 1,
            video = snapshot.video.takeIf { hasVideo },
            videoDecoder = snapshot.videoDecoder.takeIf { hasVideo },
            decoderSupport = if (hasVideo) snapshot.decoderSupport else DecoderSupport(),
            audioMime = snapshot.audioMime.takeIf { hasAudio },
            audioDecoder = snapshot.audioDecoder.takeIf { hasAudio },
        )
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        snapshot = snapshot.copy(
            video = format.toVideoInfo(),
            decoderSupport = context?.let { queryDecoderSupport(it, format) } ?: DecoderSupport(),
        )
    }

    override fun onAudioInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        snapshot = snapshot.copy(audioMime = format.sampleMimeType)
    }

    override fun onVideoDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        snapshot = snapshot.copy(videoDecoder = decoderName)
    }

    override fun onAudioDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        snapshot = snapshot.copy(audioDecoder = decoderName)
    }

    override fun onAudioDecoderReleased(eventTime: AnalyticsListener.EventTime, decoderName: String) {
        if (snapshot.audioDecoder == decoderName) snapshot = snapshot.copy(audioDecoder = null)
    }

    override fun onVideoDecoderReleased(eventTime: AnalyticsListener.EventTime, decoderName: String) {
        if (snapshot.videoDecoder == decoderName) snapshot = snapshot.copy(videoDecoder = null)
    }

    override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
        snapshot = snapshot.copy(
            droppedFrames = snapshot.droppedFrames + droppedFrames,
            droppedFrameSampleMs = snapshot.droppedFrameSampleMs + elapsedMs,
        )
    }

    override fun onBandwidthEstimate(
        eventTime: AnalyticsListener.EventTime,
        totalLoadTimeMs: Int,
        totalBytesLoaded: Long,
        bitrateEstimate: Long,
    ) {
        snapshot = snapshot.copy(bandwidthKbps = (bitrateEstimate / 1000).toInt())
    }
}
