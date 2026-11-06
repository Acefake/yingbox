package com.yingbox.android.settings

import com.yingbox.android.server.ServerClient
import org.json.JSONObject

/** 元数据语言（与桌面 `scrape.metadataLanguage` 同一个键、同一组取值） */
enum class MetadataLanguage(val value: String, val label: String) {
    ZH_CN("zh-CN", "简体"),
    ZH_TW("zh-TW", "繁體"),
    EN_US("en-US", "English"),
    JA_JP("ja-JP", "日本語"),
    KO_KR("ko-KR", "한국어"),
    ;

    companion object {
        fun of(value: String?): MetadataLanguage = entries.firstOrNull { it.value == value } ?: ZH_CN
    }
}

/**
 * 服务端保存的设置（GET / POST /api/server-settings，键见 shared/settings/server-keys.ts）。
 * 服务端按桌面同一套 schema 校验，值不合法时回 400，这里抛 [com.yingbox.android.server.ServerCallException]。
 * 阻塞调用，不要放主线程。
 */
class ServerSettingsApi(private val client: ServerClient) {
    fun metadataLanguage(): MetadataLanguage =
        MetadataLanguage.of(JSONObject(client.get(PATH)).optJSONObject("values")?.optString(LANGUAGE_KEY))

    fun setMetadataLanguage(language: MetadataLanguage) {
        client.post(PATH, JSONObject().put("key", LANGUAGE_KEY).put("value", language.value))
    }

    /** 三类图片的清晰度（与桌面同一组设置键）；取不到的按高清 */
    fun imageQualities(): Map<ImageKind, ImageQuality> {
        val values = JSONObject(client.get(PATH)).optJSONObject("values")
        return ImageKind.entries.associateWith { ImageQuality.of(values?.optString(it.key)) }
    }

    fun setImageQuality(kind: ImageKind, quality: ImageQuality) {
        client.post(PATH, JSONObject().put("key", kind.key).put("value", quality.value))
    }

    /** TMDB 令牌是否已配置（环境变量里的也算）；令牌明文只写不读 */
    fun tmdbConfigured(): Boolean = providerCall("getProviderStatus", null)

    /** 保存 TMDB 令牌，空串清除；返回保存后是否已配置。服务端写进自己的密钥文件，与桌面、网页端同一套 */
    fun setTmdbToken(token: String): Boolean =
        providerCall("setProviderToken", JSONObject().put("provider", "tmdb").put("token", token.trim().ifEmpty { JSONObject.NULL }))

    private fun providerCall(method: String, params: JSONObject?): Boolean {
        val body = JSONObject().put("method", method).put("params", params ?: JSONObject.NULL)
        val reply = JSONObject(client.post("/api/library/rpc", body))
        if (!reply.optBoolean("ok")) throw IllegalStateException(reply.optJSONObject("error")?.optString("message") ?: "保存失败")
        return reply.getJSONObject("result").getJSONObject("tmdb").getBoolean("configured")
    }

    fun networkOptions(): NetworkOptions = NetworkOptions.parse(
        JSONObject(client.get(PATH)).optJSONObject("values")?.optJSONObject("network.optimization"),
    )

    fun setNetworkOptions(value: NetworkOptions) {
        client.post(PATH, JSONObject().put("key", "network.optimization").put("value", value.json()))
    }

    fun probeNetwork(value: NetworkOptions): String {
        val rows = org.json.JSONArray(client.post("/api/network/probe", value.json()))
        return (0 until rows.length()).joinToString("\n\n") { i ->
            val row = rows.getJSONObject(i)
            "${row.getString("purpose")} · ${if (row.getBoolean("ok")) "通过" else "未通过"}\n${row.getString("endpoint")}\n${row.getString("detail")}"
        }
    }

    private companion object {
        const val PATH = "/api/server-settings"
        const val LANGUAGE_KEY = "scrape.metadataLanguage"
    }
}
