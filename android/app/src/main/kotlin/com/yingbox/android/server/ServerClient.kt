package com.yingbox.android.server

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 访问内嵌服务。只发到 [ServerState.Ready] 给出的回环地址，带令牌。阻塞调用，不要放主线程。 */
class ServerClient(private val ready: ServerState.Ready) {
    fun get(path: String): String = String(bytes(path), Charsets.UTF_8)

    /** 取原始字节（缩略图等）；path 是本服务的路径，如 /media/thumb?w=342&src=… */
    fun bytes(path: String): ByteArray = request("GET", path, null)

    /**
     * 调一个契约域方法（POST /api/domains/:domain/:method），返回 value
     * （JSONObject、JSONArray、字符串、数字或 null）。服务端返回 ok: false 时抛 [ServerCallException]。
     */
    fun call(domain: String, method: String, args: JSONArray = JSONArray()): Any? {
        val body = JSONObject().put("args", args).toString().toByteArray()
        val reply = JSONObject(String(request("POST", "/api/domains/$domain/$method", body), Charsets.UTF_8))
        if (!reply.optBoolean("ok")) throw ServerCallException("$domain.$method：${reply.optString("error")}")
        return if (reply.isNull("value")) null else reply.get("value")
    }

    private fun request(method: String, path: String, body: ByteArray?): ByteArray {
        val c = URL(ready.baseUrl + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 3_000
        // 首页第一次要拼几十个豆瓣、TMDB 请求
        c.readTimeout = 60_000
        c.setRequestProperty("Authorization", "Bearer ${ready.token}")
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body) }
            }
            val code = c.responseCode
            val bytes = (if (code < 400) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            if (code >= 400) throw ServerCallException("$method $path → $code：${String(bytes).take(200)}")
            return bytes
        } finally {
            c.disconnect()
        }
    }
}

class ServerCallException(message: String) : Exception(message)
