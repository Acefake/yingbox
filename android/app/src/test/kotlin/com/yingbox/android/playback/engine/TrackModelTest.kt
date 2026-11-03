package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackModelTest {
    private fun audio(lang: String?, mime: String?, ch: Int, label: String? = null) =
        TrackDescriptor(lang, label, mime, ch)

    @Test fun `Atmos 7_1`() {
        assertEquals("中文 · Atmos 7.1", audioLabel(audio("chi", "audio/eac3-joc", 8)))
    }

    @Test fun `TrueHD 和 DTS`() {
        assertEquals("英语 · TrueHD 7.1", audioLabel(audio("eng", "audio/true-hd", 8)))
        assertEquals("日语 · DTS 5.1", audioLabel(audio("jpn", "audio/vnd.dts", 6)))
        assertEquals("英语 · DTS-HD 5.1", audioLabel(audio("eng", "audio/vnd.dts.hd", 6)))
    }

    @Test fun `没有语言时只有编码和声道`() {
        assertEquals("AC3 2.0", audioLabel(audio("und", "audio/ac3", 2)))
        assertEquals("AAC 2.0", audioLabel(audio(null, "audio/mp4a-latm", 2)))
    }

    @Test fun `轨道标题追加在末尾`() {
        assertEquals("英语 · AC3 5.1 (导演评论)", audioLabel(audio("eng", "audio/ac3", 6, "导演评论")))
    }

    @Test fun `什么都不知道时有兜底名`() {
        assertEquals("音轨", audioLabel(audio(null, null, -1)))
        assertEquals("字幕", subtitleLabel(TrackDescriptor(null, null, null, -1)))
    }

    @Test fun `字幕`() {
        assertEquals("中文 · PGS", subtitleLabel(TrackDescriptor("zho", null, "application/pgs", -1)))
        assertEquals("英语 · ASS · 外挂", subtitleLabel(TrackDescriptor("eng", null, "text/x-ssa", -1, external = true)))
        assertEquals("中文 · SRT", subtitleLabel(TrackDescriptor("chs", null, "application/x-subrip", -1)))
    }

    @Test fun `不认识的语言原样显示`() {
        assertEquals("xx · AC3 2.0", audioLabel(audio("xx", "audio/ac3", 2)))
    }

    @Test fun `软解提示`() {
        assertEquals(
            "本设备不支持 DTS，已改用软解",
            softwareAudioNotice("ffmpeg6.0-dca", "audio/vnd.dts"),
        )
        assertNull(softwareAudioNotice("c2.android.eac3.decoder", "audio/eac3"))
        assertNull(softwareAudioNotice(null, "audio/ac3"))
    }
}
