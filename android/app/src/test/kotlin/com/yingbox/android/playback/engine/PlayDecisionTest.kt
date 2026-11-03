package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayDecisionTest {
    private fun caps(dv: Set<Int> = emptySet(), hdr: Set<HdrKind> = emptySet()) =
        Capabilities.NONE.copy(dvProfiles = dv, displayHdr = hdr)

    private fun dv(profile: Int) = VideoInfo(3840, 2160, HdrKind.DolbyVision, DvInfo(profile, 6), "dvhe.0$profile.06")

    private val hdr10 = VideoInfo(3840, 2160, HdrKind.Hdr10, null, "hvc1.2.4.L153.B0")

    @Test fun `非杜比视界原样解码`() {
        assertEquals(VideoPlan.Direct, planVideo(hdr10, caps()))
    }

    @Test fun `设备有对应 DV 解码器就走 DV`() {
        assertEquals(VideoPlan.Direct, planVideo(dv(8), caps(dv = setOf(8))))
    }

    @Test fun `P8 没有 DV 解码器，屏幕支持 HDR10 就按 HDR10 显示`() {
        assertEquals(
            VideoPlan.BaseLayer(HdrKind.Hdr10),
            planVideo(dv(8), caps(hdr = setOf(HdrKind.Hdr10))),
        )
    }

    @Test fun `P7 没有 DV 解码器，屏幕不支持 HDR 就按 SDR 显示`() {
        assertEquals(VideoPlan.BaseLayer(HdrKind.Sdr), planVideo(dv(7), caps()))
    }

    @Test fun `P5 没有 DV 解码器有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(hdr = setOf(HdrKind.Hdr10))))
    }

    @Test fun `解码器只支持 P8 时 P5 仍有颜色风险`() {
        assertEquals(VideoPlan.ColorRisk, planVideo(dv(5), caps(dv = setOf(8))))
    }

    @Test fun `提示文案`() {
        assertNull(VideoPlan.Direct.notice())
        assertEquals("本设备不支持杜比视界，已按 HDR10 播放", VideoPlan.BaseLayer(HdrKind.Hdr10).notice())
        assertEquals("本设备不支持杜比视界，已按 SDR 播放", VideoPlan.BaseLayer(HdrKind.Sdr).notice())
        assertEquals("本设备不支持杜比视界 Profile 5，颜色可能不正确", VideoPlan.ColorRisk.notice())
    }
}
