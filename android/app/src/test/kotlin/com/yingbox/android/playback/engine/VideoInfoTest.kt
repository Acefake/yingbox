package com.yingbox.android.playback.engine

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VideoInfoTest {
    @Test fun `解析 P8 编码串`() {
        assertEquals(DvInfo(8, 6), parseDv("dvhe.08.06"))
    }

    @Test fun `多个编码里找到杜比视界`() {
        assertEquals(DvInfo(5, 9), parseDv("hvc1.2.4.L153.B0, dvh1.05.09"))
    }

    @Test fun `AV1 的杜比视界是 profile 10`() {
        assertEquals(DvInfo(10, 9), parseDv("dav1.10.09"))
    }

    @Test fun `普通 HEVC 和空值都不是杜比视界`() {
        assertNull(parseDv("hvc1.2.4.L153.B0"))
        assertNull(parseDv(null))
    }

    @Test fun `PQ 传输特性是 HDR10`() {
        val v = videoInfo(3840, 2160, "hvc1.2.4.L153.B0", C.COLOR_TRANSFER_ST2084)
        assertEquals(HdrKind.Hdr10, v.hdr)
        assertNull(v.dv)
    }

    @Test fun `HLG 传输特性是 HLG`() {
        assertEquals(HdrKind.Hlg, videoInfo(1920, 1080, null, C.COLOR_TRANSFER_HLG).hdr)
    }

    @Test fun `没有传输特性是 SDR`() {
        assertEquals(HdrKind.Sdr, videoInfo(1920, 1080, "avc1.640028", C.COLOR_TRANSFER_SDR).hdr)
    }

    @Test fun `杜比视界编码串优先于传输特性`() {
        val v = videoInfo(3840, 2160, "dvhe.08.06", C.COLOR_TRANSFER_ST2084)
        assertEquals(HdrKind.DolbyVision, v.hdr)
        assertEquals(DvInfo(8, 6), v.dv)
    }
}
