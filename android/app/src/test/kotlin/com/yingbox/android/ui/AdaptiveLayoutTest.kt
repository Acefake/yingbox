package com.yingbox.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveLayoutTest {
    @Test fun `手机横竖屏使用触摸布局`() {
        assertEquals(AdaptiveLayout.Phone, adaptiveLayout(390, 844, false))
        assertEquals(AdaptiveLayout.Phone, adaptiveLayout(844, 390, false))
    }

    @Test fun `平板旋转与分屏按可用宽度切换`() {
        assertEquals(AdaptiveLayout.Tablet, adaptiveLayout(768, 1024, false))
        assertEquals(AdaptiveLayout.Tablet, adaptiveLayout(1024, 768, false))
        assertEquals(AdaptiveLayout.Phone, adaptiveLayout(507, 1024, false))
    }

    @Test fun `窄窗口电视仍保留遥控器布局`() {
        assertEquals(AdaptiveLayout.Tv, adaptiveLayout(540, 960, true))
    }
}
