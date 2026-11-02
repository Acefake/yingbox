package com.yingbox.android.server

import java.net.HttpURLConnection
import java.net.URL

/** 访问内嵌服务。只发到 [ServerState.Ready] 给出的回环地址，带令牌。阻塞调用，不要放主线程。 */
class ServerClient(private val ready: ServerState.Ready) {
    fun get(path: String): String {
        val c = URL(ready.baseUrl + path).openConnection() as HttpURLConnection
        c.connectTimeout = 3_000
        c.readTimeout = 15_000
        c.setRequestProperty("Authorization", "Bearer ${ready.token}")
        try {
            val code = c.responseCode
            val body = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
            check(code < 400) { "GET $path → $code：${body.take(200)}" }
            return body
        } finally {
            c.disconnect()
        }
    }
}
