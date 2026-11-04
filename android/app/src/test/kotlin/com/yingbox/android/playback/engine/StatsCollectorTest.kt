package com.yingbox.android.playback.engine

import androidx.media3.common.Timeline
import androidx.media3.exoplayer.analytics.AnalyticsListener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatsCollectorTest {
    @Test fun `多视频轨时不能将文件探测套到当前轨`() {
        val stats = StatsCollector()
        val probe = FileVideoProbe(42, HdrKind.DolbyVision, 8, 1)
        stats.reset(probe)
        stats.clearMissingTracks(true, true, 2)
        assertEquals(false, stats.snapshot.sourceProbeApplicable)
        stats.clearMissingTracks(true, true, 1)
        assertEquals(true, stats.snapshot.sourceProbeApplicable)
        stats.reset()
        assertNull(stats.snapshot.sourceVideo)
        assertEquals(false, stats.snapshot.sourceProbeApplicable)
    }

    private val event = AnalyticsListener.EventTime(0, Timeline.EMPTY, 0, null, 0, Timeline.EMPTY, 0, null, 0, 0)

    @Test fun `音轨直通前释放解码器后报告不残留旧名称`() {
        val stats = StatsCollector()
        stats.onAudioDecoderInitialized(event, "decoder.old", 0, 0)
        stats.onAudioDecoderReleased(event, "decoder.old")
        assertNull(stats.snapshot.audioDecoder)
    }

    @Test fun `旧释放事件不能清除新解码器`() {
        val stats = StatsCollector()
        stats.onAudioDecoderInitialized(event, "decoder.new", 0, 0)
        stats.onAudioDecoderReleased(event, "decoder.old")
        assertEquals("decoder.new", stats.snapshot.audioDecoder)
        stats.onVideoDecoderInitialized(event, "video.new", 0, 0)
        stats.onVideoDecoderReleased(event, "video.old")
        assertEquals("video.new", stats.snapshot.videoDecoder)
    }

    @Test fun `换片时清空解码器和丢帧采样`() {
        val stats = StatsCollector()
        stats.onAudioDecoderInitialized(event, "decoder.old", 0, 0)
        stats.onDroppedVideoFrames(event, 3, 1000)
        stats.reset()
        assertEquals(StatsSnapshot(), stats.snapshot)
    }
}
