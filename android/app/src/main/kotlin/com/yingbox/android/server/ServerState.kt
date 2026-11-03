package com.yingbox.android.server

/** 内嵌服务的状态。界面只看这一个值。 */
sealed interface ServerState {
    /** 解压服务端、启动进程、等待 /api/health。[attempt] 从 1 开始，崩溃重启时递增。 */
    data class Starting(val attempt: Int) : ServerState

    /** 可以访问：只监听 127.0.0.1，请求带 `Authorization: Bearer <token>`。 */
    data class Ready(val baseUrl: String, val token: String) : ServerState

    /** 连续崩溃或启动失败，不再自动重试。[logTail] 是 node 最后输出的几十行。 */
    data class Failed(val message: String, val logTail: List<String>) : ServerState

    data object Stopped : ServerState
}
