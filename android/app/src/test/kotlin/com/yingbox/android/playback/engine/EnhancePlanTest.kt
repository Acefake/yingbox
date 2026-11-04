package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EnhancePlanTest {
    private fun video(height: Int, hdr: HdrKind = HdrKind.Sdr, dv: DvInfo? = null) =
        VideoInfo(width = height * 16 / 9, height = height, hdr = hdr, dv = dv, codecs = null)

    @Test
    fun `低于屏幕高度的 SDR 放大并锐化`() {
        val plan = enhancePlan(EnhanceLevel.Standard, video(720), 2160)
        assertEquals(EnhancePlan(2160, EnhanceLevel.Standard.strength), plan)
    }

    @Test
    fun `已达屏幕高度只锐化不放大`() {
        assertEquals(EnhancePlan(null, EnhanceLevel.Soft.strength), enhancePlan(EnhanceLevel.Soft, video(1080), 1080))
    }

    @Test
    fun `档位越高 RCAS 越锐，强度在 0 到 1 之间`() {
        assertTrue(EnhanceLevel.Soft.strength < EnhanceLevel.Standard.strength)
        assertTrue(EnhanceLevel.Standard.strength < EnhanceLevel.Strong.strength)
        assertTrue(EnhanceLevel.Strong.strength <= 1f)
    }

    @Test
    fun `EASU 输出宽度按比例取偶数`() {
        assertEquals(3840 to 2160, easuOutputSize(1920, 1080, 2160))
        assertEquals(1282 to 720, easuOutputSize(854, 480, 720))
        assertEquals(0, easuOutputSize(853, 480, 1080).first % 2)
    }

    @Test
    fun `放大目标不超过 2160`() {
        assertEquals(2160, enhancePlan(EnhanceLevel.Strong, video(1080), 4320)?.targetHeight)
    }

    @Test
    fun `缺色彩信息的 H264 或 8 位片源按 SDR 处理`() {
        val avc = video(720, HdrKind.Unknown).copy(codecs = "avc1.640028")
        assertEquals(EnhancePlan(2160, EnhanceLevel.Standard.strength), enhancePlan(EnhanceLevel.Standard, avc, 2160))
        val eightBit = video(720, HdrKind.Unknown).copy(bitDepth = 8)
        assertEquals(EnhancePlan(2160, EnhanceLevel.Standard.strength), enhancePlan(EnhanceLevel.Standard, eightBit, 2160))
    }

    @Test
    fun `关闭、HDR、杜比视界和未知规格保持原生`() {
        assertNull(enhancePlan(EnhanceLevel.Off, video(720), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, video(720, HdrKind.Hdr10), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, video(720, HdrKind.Hlg), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, video(720, HdrKind.Sdr, DvInfo(8, 6)), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, video(720, HdrKind.Unknown), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, video(720, HdrKind.Unknown).copy(codecs = "hvc1.2.4.L120", bitDepth = 10), 2160))
        assertNull(enhancePlan(EnhanceLevel.Standard, null, 2160))
    }
}
