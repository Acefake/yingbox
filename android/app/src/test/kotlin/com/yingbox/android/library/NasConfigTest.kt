package com.yingbox.android.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NasConfigTest {
    @Test fun `没写协议补 http`() {
        assertEquals("http://192.168.1.5:31480", normalizeNasUrl("192.168.1.5:31480"))
    }

    @Test fun `去掉首尾空白和尾部斜杠`() {
        assertEquals("http://nas.local", normalizeNasUrl(" http://nas.local/ "))
        assertEquals("https://x.y/a", normalizeNasUrl("https://x.y/a/"))
    }

    @Test fun `协议不区分大小写`() {
        assertEquals("HTTP://nas.local:8080", normalizeNasUrl("HTTP://nas.local:8080"))
    }

    @Test fun `带下划线的主机名和用户信息都放行`() {
        assertEquals("http://my_nas:8080", normalizeNasUrl("my_nas:8080"))
        assertEquals("http://u:p@nas.local", normalizeNasUrl("http://u:p@nas.local/"))
    }

    @Test fun `空串、非 http 协议、带空格的都不合法`() {
        assertNull(normalizeNasUrl(""))
        assertNull(normalizeNasUrl("   "))
        assertNull(normalizeNasUrl("ftp://x"))
        assertNull(normalizeNasUrl("a b"))
        assertNull(normalizeNasUrl("http://"))
        assertNull(normalizeNasUrl("http://:80"))
        assertNull(normalizeNasUrl("http://user@"))
        assertNull(normalizeNasUrl("http://?x=1"))
    }
}
