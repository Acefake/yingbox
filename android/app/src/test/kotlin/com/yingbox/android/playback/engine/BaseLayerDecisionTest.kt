package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BaseLayerDecisionTest {
    private val video = VideoInfo(3840, 2160, HdrKind.DolbyVision, DvInfo(8, 6), "dvhe.08.06")
    private val caps = Capabilities.NONE.copy(displayKnown = true, displayHdr = setOf(HdrKind.Hdr10, HdrKind.Hlg))
    private fun probe(compat: Int, profile: Int = 8) = FileVideoProbe(42, HdrKind.DolbyVision, profile, compat)

    @Test fun `相同 profile 的 P8 基础层按实际兼容号分类`() {
        assertEquals(HdrKind.Hdr10, video.baseLayerOf(probe(1)))
        assertEquals(HdrKind.Sdr, video.baseLayerOf(probe(2)))
        assertEquals(HdrKind.Hlg, video.baseLayerOf(probe(4)))
        assertNull(video.baseLayerOf(probe(0)))
        assertNull(video.baseLayerOf(probe(15)))
        assertNull(video.baseLayerOf(probe(1, 7)))
        assertNull(video.baseLayerOf(null))
    }

    @Test fun `只有兼容号不能冒充基础层解码可用`() {
        assertEquals(VideoPlan.Unverified, planVideo(video, caps, DecoderSupport(), probe(1)))
        assertEquals(VideoPlan.DecoderUnsupported, planVideo(video, caps, DecoderSupport(false, false), probe(1)))
    }

    @Test fun `解码器和显示支持对应基础层时仅声明候选`() {
        for ((compat, hdr) in listOf(1 to HdrKind.Hdr10, 2 to HdrKind.Sdr, 4 to HdrKind.Hlg)) {
            assertEquals(VideoPlan.BaseLayerCandidate(hdr), planVideo(video, caps, DecoderSupport(false, true), probe(compat)))
        }
        assertEquals(VideoPlan.CompatibilityUnknown, planVideo(video, caps, DecoderSupport(false, true), probe(15)))
    }

    @Test fun `超出实际 codec 格式支持时不能因 profile 存在就走原生`() {
        val dvCaps = caps.copy(dvProfiles = setOf(8), displayHdr = setOf(HdrKind.DolbyVision))
        assertEquals(VideoPlan.DecoderUnsupported, planVideo(video, dvCaps, DecoderSupport(false, false), null))
        assertEquals(VideoPlan.Direct, planVideo(video, dvCaps, DecoderSupport(true, false), null))
    }
}
