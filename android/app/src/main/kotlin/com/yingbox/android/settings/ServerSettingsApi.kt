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

    private companion object {
        const val PATH = "/api/server-settings"
        const val LANGUAGE_KEY = "scrape.metadataLanguage"
    }
}
