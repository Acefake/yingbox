package com.yingbox.android.library

import kotlinx.coroutines.delay
import java.util.concurrent.atomic.AtomicInteger

/**
 * 还没写到 NAS 的进度。退出播放器时最后一次进度是异步发的，详情页紧接着读进度，
 * 先等这些写入落地，免得「继续播放」「已看完」显示旧值。
 */
object ProgressWrites {
    private val pending = AtomicInteger()

    /** 入队一次写入时调用，写完（成功或失败）后调用 [end] */
    fun begin() {
        pending.incrementAndGet()
    }

    fun end() {
        pending.decrementAndGet()
    }

    /** 等排队的写入发完，最多等 [maxMs]；NAS 不通时别一直卡着详情页 */
    suspend fun settle(maxMs: Long = 3_000) {
        var waited = 0L
        while (pending.get() > 0 && waited < maxMs) {
            delay(STEP_MS)
            waited += STEP_MS
        }
    }

    private const val STEP_MS = 100L
}
