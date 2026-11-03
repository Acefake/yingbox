package com.yingbox.android.library

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 测试连接的结果 */
enum class NasStatus(val label: String) {
    Ok("已连接"),
    Unreachable("连不上，检查地址和网络"),
    Unauthorized("令牌不对或服务需要令牌"),
}

/** 用 `/api/health` 检查 NAS 上的影盒服务。阻塞调用，不要放主线程。 */
object NasProbe {
    fun check(config: NasConfig): NasStatus {
        val connection = runCatching { URL(config.url + "/api/health").openConnection() as HttpURLConnection }
            .getOrElse { return NasStatus.Unreachable }
        return try {
            connection.connectTimeout = 4_000
            connection.readTimeout = 6_000
            if (config.token.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer ${config.token}")
            when (connection.responseCode) {
                200 -> Unit
                401 -> return NasStatus.Unauthorized
                else -> return NasStatus.Unreachable
            }
            val body = JSONObject(connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) })
            when {
                !body.optBoolean("ok") -> NasStatus.Unreachable
                body.optBoolean("authorized", true) -> NasStatus.Ok
                else -> NasStatus.Unauthorized
            }
        } catch (e: Exception) {
            NasStatus.Unreachable
        } finally {
            connection.disconnect()
        }
    }
}
