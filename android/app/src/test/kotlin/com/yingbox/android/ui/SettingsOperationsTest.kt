package com.yingbox.android.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsOperationsTest {
    @Test fun `服务端写入完成后设备写入完成前不能切换分类`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        try {
            val response = CompletableDeferred<Unit>()
            var deviceSaved = false
            val saving = scope.launch {
                response.await()
                deviceSaved = true
            }
            assertFalse(canLeaveSettings(scope))
            assertFalse(deviceSaved)
            response.complete(Unit)
            saving.join()
            assertTrue(deviceSaved)
            assertTrue(canLeaveSettings(scope))
        } finally { scope.cancel() }
    }

    @Test fun `失败结果处理后允许离开`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        try {
            val response = CompletableDeferred<Unit>()
            var failureHandled = false
            val saving = scope.launch {
                try { response.await() } catch (_: IllegalStateException) { failureHandled = true }
            }
            assertFalse(canLeaveSettings(scope))
            response.completeExceptionally(IllegalStateException("保存失败"))
            saving.join()
            assertTrue(failureHandled)
            assertTrue(canLeaveSettings(scope))
        } finally { scope.cancel() }
    }
}
