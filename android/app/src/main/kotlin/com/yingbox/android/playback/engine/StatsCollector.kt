package com.yingbox.android.playback.engine

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
    val videoDecoder: String? = null,
    val audioDecoder: String? = null,
    val audioMime: String? = null,
    /** 带宽估计（不是视频码率） */
    val bandwidthKbps: Int = 0,
    val droppedFrames: Int = 0,
)

/** 收集解码器名、码率、丢帧；读 [snapshot] 的 Compose 会随更新重组。 */
@OptIn(UnstableApi::class)
class StatsCollector : AnalyticsListener {
    var snapshot by mutableStateOf(StatsSnapshot())
        private set

    /** 换了一集或换源时清零 */
    fun reset() {
        snapshot = StatsSnapshot()
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        snapshot = snapshot.copy(video = format.toVideoInfo())
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

    override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
        snapshot = snapshot.copy(droppedFrames = snapshot.droppedFrames + droppedFrames)
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
