package com.yingbox.android.server

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 访问内嵌服务。只发到 [ServerState.Ready] 给出的回环地址，带令牌。阻塞调用，不要放主线程。 */
class ServerClient(private val ready: ServerState.Ready) {
    /** 本服务路径 → 完整地址（给播放器用） */
    fun url(path: String): String = ready.baseUrl + path

    /** 播放器请求清单和分片时带的鉴权头 */
    val authorization: String get() = "Bearer ${ready.token}"

    /** GET 一个路径取文本；[timeoutMs] 是读超时，慢一点也无所谓的请求用默认值，可有可无的请求给短一点 */
    fun get(path: String, timeoutMs: Int = READ_TIMEOUT_MS): String =
        String(request("GET", path, null, timeoutMs), Charsets.UTF_8)

    /** POST 一个 JSON 到本服务的路径，返回响应文本 */
    fun post(path: String, body: JSONObject): String =
        String(request("POST", path, body.toString().toByteArray()), Charsets.UTF_8)

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

    /**
     * 调一个片库方法（POST /api/library/rpc，方法与参数同桌面端 IPC），返回 result
     * （JSONObject、JSONArray、字符串、数字或 null）。服务端返回 ok: false 时抛 [ServerCallException]。
     */
    fun library(method: String, params: JSONObject = JSONObject()): Any? {
        val body = JSONObject().put("method", method).put("params", params).toString().toByteArray()
        val reply = JSONObject(String(request("POST", "/api/library/rpc", body), Charsets.UTF_8))
        if (!reply.optBoolean("ok")) {
            throw ServerCallException("library.$method：${reply.optJSONObject("error")?.optString("message")}")
        }
        return if (reply.isNull("result")) null else reply.get("result")
    }

    private fun request(method: String, path: String, body: ByteArray?, timeoutMs: Int = READ_TIMEOUT_MS): ByteArray {
        val c = URL(ready.baseUrl + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 3_000
        // 首页第一次要拼几十个豆瓣、TMDB 请求
        c.readTimeout = timeoutMs
        c.setRequestProperty("Authorization", authorization)
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body) }
            }
            val code = c.responseCode
            val bytes = (if (code < 400) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            if (code >= 400) throw ServerStatusException(code, "$method $path → $code：${String(bytes).take(200)}")
            return bytes
        } finally {
            c.disconnect()
        }
    }
}

/** 服务端调用失败（ok: false 等） */
open class ServerCallException(message: String) : Exception(message)

/** 服务端回了 4xx / 5xx；[status] 是 HTTP 状态码（401 是令牌不对或服务需要令牌） */
class ServerStatusException(val status: Int, message: String) : ServerCallException(message)

/** 读超时：首页第一次要拼几十个豆瓣、TMDB 请求 */
private const val READ_TIMEOUT_MS = 60_000
