package com.yingbox.android.playback.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDiagnosticsTest {
    @Test fun `报告不把输入 DV 宣称为最终输出`() {
        val stats = StatsSnapshot(video = VideoInfo(3840, 2160, HdrKind.DolbyVision, DvInfo(8, 6), "dvhe.08.06"))
        val report = playbackDiagnosticReport(stats, Capabilities.NONE, VideoPlan.Unverified)
        assertTrue(report.contains("杜比视界"))
        assertTrue(report.contains("输出模式未确认"))
        assertTrue(report.contains("基础层兼容 ID：未知"))
    }

    @Test fun `外部格式与解码器字符串不泄露地址或凭据`() {
        val secret = "https://user:password@host/movie?token=secret"
        val stats = StatsSnapshot(video = VideoInfo(1920, 1080, HdrKind.Unknown, null, secret), videoDecoder = secret)
        val report = playbackDiagnosticReport(stats, Capabilities.NONE, VideoPlan.Unverified)
        assertFalse(report.contains(secret))
        assertFalse(report.contains("password"))
        assertFalse(report.contains("token="))
    }
}
