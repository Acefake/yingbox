package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayDecisionTest {
    private fun planVideo(video: VideoInfo, caps: Capabilities): VideoPlan =
        com.yingbox.android.playback.engine.planVideo(video, caps, DecoderSupport(video.dv?.let { it.profile in caps.dvProfiles } ?: true, true))
    private fun caps(dv: Set<Int> = emptySet(), hdr: Set<HdrKind> = emptySet()) =
        Capabilities.NONE.copy(dvProfiles = dv, displayHdr = hdr, displayKnown = true)

    private fun dv(profile: Int) = VideoInfo(3840, 2160, HdrKind.DolbyVision, DvInfo(profile, 6), "dvhe.0$profile.06")

    private val hdr10 = VideoInfo(3840, 2160, HdrKind.Hdr10, null, "hvc1.2.4.L153.B0")

    @Test fun `HDR 显示能力不足不能宣称已转换`() {
        assertEquals(VideoPlan.DisplayMismatch, planVideo(hdr10, caps()))
        assertEquals(VideoPlan.Direct, planVideo(hdr10, caps(hdr = setOf(HdrKind.Hdr10))))
    }

    @Test fun `设备有对应 DV 解码器就走 DV`() {
        assertEquals(VideoPlan.Direct, planVideo(dv(8), caps(dv = setOf(8), hdr = setOf(HdrKind.DolbyVision))))
        assertEquals(VideoPlan.DisplayMismatch, planVideo(dv(8), caps(dv = setOf(8))))
    }

    @Test fun `P8 兼容层未知不能根据屏幕推断已降级`() {
        assertEquals(
            VideoPlan.CompatibilityUnknown,
            planVideo(dv(8), caps(hdr = setOf(HdrKind.Hdr10))),
        )
    }

    @Test fun `P7 P10 不能宣称已映射成 SDR`() {
        assertEquals(VideoPlan.CompatibilityUnknown, planVideo(dv(7), caps()))
        assertEquals(VideoPlan.CompatibilityUnknown, planVideo(dv(10), caps()))
    }

    @Test fun `P5 没有 DV 解码器有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(hdr = setOf(HdrKind.Hdr10))))
    }

    @Test fun `解码器只支持 P8 时 P5 仍有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(dv = setOf(8))))
    }

    @Test fun `提示文案`() {
        assertNull(VideoPlan.Direct.notice())
        assertEquals("未发现对应的杜比视界解码器，兼容层播放尚未确认", VideoPlan.CompatibilityUnknown.notice())
        assertEquals("显示设备未声明支持此动态范围，色调映射尚未确认", VideoPlan.DisplayMismatch.notice())
        assertEquals("未找到可用的杜比视界解码路径，片源没有已确认的兼容层，颜色可能不正确", VideoPlan.ColorRisk.notice())
    }

    @Test fun `未知格式和显示能力不声明支持`() {
        assertEquals(VideoPlan.Unverified, planVideo(dv(8), Capabilities.NONE))
        assertEquals(VideoPlan.Unverified, planVideo(hdr10.copy(hdr = HdrKind.Unknown), caps()))
        assertEquals(VideoPlan.Unverified, planVideo(dv(8).copy(dv = null), caps()))
    }
}
