package com.yingbox.android.settings

import org.json.JSONArray
import org.json.JSONObject

/** 与内嵌服务 network.optimization 同构的公开网络配置。 */
data class NetworkOptions(
    val githubMode: String = "auto",
    val mirrors: List<String> = BUILTINS,
    val tmdbMode: String = "auto",
) {
    fun json(): JSONObject = JSONObject().put("githubMode", githubMode)
        .put("mirrors", JSONArray(mirrors)).put("tmdbMode", tmdbMode)

    companion object {
        val BUILTINS = listOf("https://gh-proxy.com/", "https://ghfast.top/", "https://ghproxy.net/")

        fun parse(value: JSONObject?): NetworkOptions {
            if (value == null) return NetworkOptions()
            val array = value.optJSONArray("mirrors")
            return NetworkOptions(
                githubMode = value.optString("githubMode", "auto"),
                mirrors = array?.let { (0 until it.length()).map(it::getString) } ?: BUILTINS,
                tmdbMode = value.optString("tmdbMode", "auto"),
            )
        }
    }
}
