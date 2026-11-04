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
