package com.yingbox.android.playback.engine

import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorsTest {
    @Test fun `解码器初始化失败`() {
        assertTrue(describeError(PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, "X").contains("解码器"))
    }

    @Test fun `规格超出能力`() {
        assertTrue(describeError(PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES, "X").contains("超出"))
    }

    @Test fun `网络超时和连接失败同一句话`() {
        assertEquals(
            describeError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, "A"),
            describeError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, "B"),
        )
    }

    @Test fun `不认识的错误码带上错误名`() {
        assertEquals("播放出错（ERROR_CODE_WHATEVER）", describeError(999_999, "ERROR_CODE_WHATEVER"))
    }
}
