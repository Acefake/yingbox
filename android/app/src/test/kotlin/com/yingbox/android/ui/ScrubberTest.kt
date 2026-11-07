package com.yingbox.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScrubberTest {
    private val sought = mutableListOf<Long>()
    private fun scrubber(duration: Long = 600_000L) = Scrubber({ duration }) { sought += it }

    @Test fun `拖动期间只记目标，commit 才真正跳转`() {
        val s = scrubber()
        s.begin(100_000L)
        s.dragTo(250_000L)
        assertEquals(250_000L, s.target)
        assertEquals(emptyList<Long>(), sought)
        s.commit()
        assertEquals(listOf(250_000L), sought)
        assertNull(s.target)
    }

    @Test fun `没拖动就 commit 不跳转`() {
        val s = scrubber()
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }

    @Test fun `遥控器连发在目标上累加并限制在片内`() {
        val s = scrubber(duration = 100_000L)
        s.begin(50_000L)
        s.step(1, 1)
        s.step(1, 2)
        assertEquals(70_000L, s.target)
        repeat(20) { s.step(1, 14) }
        assertEquals(100_000L, s.target)
        repeat(20) { s.step(-1, 14) }
        assertEquals(0L, s.target)
    }

    @Test fun `时长未知时不能拖`() {
        val s = scrubber(duration = -1L)
        s.begin(1_000L)
        s.dragTo(5_000L)
        s.step(1, 1)
        assertNull(s.target)
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }

    @Test fun `cancel 丢弃目标`() {
        val s = scrubber()
        s.begin(1_000L)
        s.dragTo(9_000L)
        s.cancel()
        assertNull(s.target)
        s.commit()
        assertEquals(emptyList<Long>(), sought)
    }
}
