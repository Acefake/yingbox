package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerFormatTest {
    @Test fun `时间显示`() {
        assertEquals("00:00", formatClock(0))
        assertEquals("00:59", formatClock(59_999))
        assertEquals("02:03", formatClock(123_000))
        assertEquals("1:02:03", formatClock(3_723_000))
        assertEquals("12:00:00", formatClock(43_200_000))
    }

    @Test fun `未知时间显示占位`() {
        assertEquals("--:--", formatClock(-1))
        assertEquals("--:--", formatClock(Long.MIN_VALUE + 1))
    }

    private fun video(width: Int, hdr: HdrKind, dv: DvInfo? = null) = VideoInfo(width, width * 9 / 16, hdr, dv, null)

    @Test fun `分辨率按宽度分档，宽银幕片也是 4K`() {
        assertEquals(listOf("4K"), playbackBadges(VideoInfo(3840, 1608, HdrKind.Sdr, null, null), null))
        assertEquals(listOf("1080p"), playbackBadges(VideoInfo(1920, 800, HdrKind.Sdr, null, null), null))
        assertEquals(listOf("720p"), playbackBadges(VideoInfo(1280, 720, HdrKind.Sdr, null, null), null))
        assertEquals(listOf("360p"), playbackBadges(VideoInfo(640, 360, HdrKind.Sdr, null, null), null))
        assertEquals(listOf("2K"), playbackBadges(VideoInfo(2560, 1440, HdrKind.Sdr, null, null), null))
    }

    @Test fun `动态范围徽标`() {
        assertEquals(listOf("4K", "杜比视界 P8"), playbackBadges(video(3840, HdrKind.DolbyVision, DvInfo(8, 6)), null))
        assertEquals(listOf("4K", "HDR10"), playbackBadges(video(3840, HdrKind.Hdr10), null))
        assertEquals(listOf("4K", "HLG"), playbackBadges(video(3840, HdrKind.Hlg), null))
    }

    @Test fun `音频徽标只标有分量的格式`() {
        assertEquals(listOf("Atmos"), playbackBadges(null, "audio/eac3-joc"))
        assertEquals(listOf("TrueHD"), playbackBadges(null, "audio/true-hd"))
        assertEquals(listOf("DTS-HD"), playbackBadges(null, "audio/vnd.dts.hd"))
        assertEquals(listOf("DTS"), playbackBadges(null, "audio/vnd.dts"))
        assertEquals(emptyList<String>(), playbackBadges(null, "audio/mp4a-latm"))
        assertEquals(emptyList<String>(), playbackBadges(null, null))
    }

    @Test fun `徽标顺序是分辨率、动态范围、音频`() {
        assertEquals(
            listOf("4K", "杜比视界 P5", "Atmos"),
            playbackBadges(video(3840, HdrKind.DolbyVision, DvInfo(5, 6)), "audio/eac3-joc"),
        )
    }

    @Test fun `滑动换算：整屏高度对应 1，向上为正`() {
        assertEquals(0.5f, gestureDelta(-300f, 600f), 1e-6f)
        assertEquals(-0.25f, gestureDelta(150f, 600f), 1e-6f)
        assertEquals(0f, gestureDelta(100f, 0f), 0f)
    }

    @Test fun `倍速文字`() {
        assertEquals("1×", speedLabel(1f))
        assertEquals("0.75×", speedLabel(0.75f))
        assertEquals("1.5×", speedLabel(1.5f))
        assertEquals("2×", speedLabel(2f))
    }
}
