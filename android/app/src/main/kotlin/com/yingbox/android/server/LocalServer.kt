package com.yingbox.android.server

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread

/**
 * 内嵌服务的入口：由 [ServerService] 启停，界面只读 [state]。
 *
 * 每次 [start] 开一个独立的 [Supervisor]，新的先等旧的线程彻底结束（进程收掉）再动手，
 * 解压目录、数据库和端口都不会有两轮同时在用。[stop] 不阻塞调用线程。
 */
object LocalServer {
    private val mutableState = MutableStateFlow<ServerState>(ServerState.Stopped)
    val state: StateFlow<ServerState> = mutableState.asStateFlow()

    private var current: Supervisor? = null

    @Synchronized
    fun start(context: Context) {
        if (current?.running == true) return
        val previous = current
        current = Supervisor(NodeRuntime(context.applicationContext), mutableState).also { it.start(after = previous) }
    }

    @Synchronized
    fun stop() {
        current?.stop()
    }
}

/**
 * 一轮守护：启动 node，等 /api/health 就绪，意外退出时退避重启；
 * 一分钟内退出 [MAX_CRASHES] 次就停在 [ServerState.Failed]，不再重试。
 */
private class Supervisor(
    private val runtime: NodeRuntime,
    private val state: MutableStateFlow<ServerState>,
) {
    /** 「已停止」和状态写入用同一把锁，停掉之后旧的这一轮不会再改状态。 */
    private val lock = Any()

    @Volatile private var stopped = false

    @Volatile private var process: Process? = null

    private var worker: Thread? = null

    val running: Boolean get() = !stopped && worker?.isAlive == true

    fun start(after: Supervisor?) {
        worker = thread(name = "yingbox-server") {
            try {
                after?.worker?.join()
            } catch (_: InterruptedException) {
                return@thread
            }
            supervise()
        }
    }

    /** 只发信号，等待和强杀在本轮的线程里做（[supervise] 的 finally）。 */
    fun stop() {
        synchronized(lock) {
            stopped = true
            state.value = ServerState.Stopped
        }
        worker?.interrupt()
        process?.destroy()
    }

    private fun publish(value: ServerState) {
        synchronized(lock) { if (!stopped) state.value = value }
    }

    private fun supervise() {
        try {
            loop()
        } catch (e: Throwable) {
            publish(ServerState.Failed("守护线程异常：$e", emptyList()))
        } finally {
            process?.let(::terminate)
        }
    }

    private fun loop() {
        val crashes = ArrayDeque<Long>()
        var attempt = 1
        publish(ServerState.Starting(attempt))
        while (!stopped) {
            val log = LogTail()
            try {
                runOnce(log)
            } catch (_: InterruptedException) {
                return
            } catch (e: Exception) {
                log.add("启动失败：$e")
            } finally {
                process?.let(::terminate)
                process = null
            }
            if (stopped) return
            val now = System.currentTimeMillis()
            crashes.addLast(now)
            while (crashes.first() < now - CRASH_WINDOW_MS) crashes.removeFirst()
            if (crashes.size >= MAX_CRASHES) {
                publish(ServerState.Failed("服务一分钟内退出 $MAX_CRASHES 次", log.lines()))
                return
            }
            // 先撤掉指向已退出进程的 Ready，再等退避
            publish(ServerState.Starting(++attempt))
            try {
                Thread.sleep(1000L shl (crashes.size - 1))
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    /** 启动一次，阻塞到进程退出。 */
    private fun runOnce(log: LogTail) {
        val dir = runtime.prepare()
        if (stopped) return
        val port = ServerSocket(0).use { it.localPort }
        val started = runtime.command(dir, port).start()
        process = started
        if (stopped) return
        val pump = thread(name = "yingbox-server-log") {
            try {
                started.inputStream.bufferedReader().forEachLine {
                    Log.i(TAG, it)
                    log.add(it)
                }
            } catch (_: IOException) {
                // 停止时 destroy() 会关掉输出流，读到一半被打断是正常结束
            }
        }
        val baseUrl = "http://127.0.0.1:$port"
        check(awaitHealthy(baseUrl, started)) { "服务 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪" }
        publish(ServerState.Ready(baseUrl, runtime.token))
        val code = started.waitFor()
        pump.join(1000)
        log.add("node 退出，退出码 $code")
    }

    private fun awaitHealthy(baseUrl: String, p: Process): Boolean {
        val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline && p.alive() && !stopped) {
            val ok = runCatching {
                val c = URL("$baseUrl/api/health").openConnection() as HttpURLConnection
                c.connectTimeout = 500
                c.readTimeout = 1000
                try {
                    c.responseCode == 200
                } finally {
                    c.disconnect()
                }
            }.getOrDefault(false)
            if (ok) return true
            Thread.sleep(100)
        }
        return false
    }

    /** SIGTERM 让服务自己收尾（关库、停引擎子进程），3 秒后仍在就强杀。 */
    private fun terminate(p: Process) {
        if (!p.alive()) return
        p.destroy()
        val deadline = System.currentTimeMillis() + 3000
        while (p.alive() && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                break
            }
        }
        // API 24、25 的 destroy() 本身就是 SIGKILL，destroyForcibly 要 API 26
        if (p.alive() && Build.VERSION.SDK_INT >= 26) p.destroyForcibly()
    }

    /** Process.isAlive 要 API 26，minSdk 是 24。 */
    private fun Process.alive(): Boolean =
        try {
            exitValue()
            false
        } catch (_: IllegalThreadStateException) {
            true
        }

    private class LogTail(private val max: Int = 60) {
        private val lines = ArrayDeque<String>()

        @Synchronized
        fun add(line: String) {
            lines.addLast(line)
            if (lines.size > max) lines.removeFirst()
        }

        @Synchronized
        fun lines(): List<String> = lines.toList()
    }

    private companion object {
        const val TAG = "YingboxServer"
        const val MAX_CRASHES = 3
        const val CRASH_WINDOW_MS = 60_000L

        /** 2 GB 盒子首次建库、迁移数据库可能要几十秒。 */
        const val READY_TIMEOUT_MS = 60_000L
    }
}
