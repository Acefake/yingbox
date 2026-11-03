package com.yingbox.android.library

import com.yingbox.android.server.ServerClient
import org.json.JSONArray
import org.json.JSONObject

/** 外挂字幕只是锦上添花：NAS 硬盘休眠、目录很大时别拖着视频不起播 */
private const val SUBTITLE_TIMEOUT_MS = 5_000

/** NAS 上影盒服务的片库接口（ADR-0040）：片库 RPC 与桌面端同一份契约。阻塞调用，不要放主线程。 */
class LibraryApi(private val client: ServerClient) {
    /** 海报墙一页；type 为空时电影和剧集都要，search 按片名搜 */
    fun query(type: LibraryType?, search: String, offset: Int, limit: Int): LibraryPage {
        val params = JSONObject().put("offset", offset).put("limit", limit).put("sort", "title")
        params.put("types", JSONArray().apply { (type?.let { listOf(it) } ?: LibraryType.entries).forEach { put(it.json) } })
        if (search.isNotBlank()) params.put("search", search.trim())
        return parseQuery(client.library("query", params) as JSONObject)
    }

    /** 条目详情；条目不存在为 null */
    fun item(itemId: Long): LibraryItem? =
        (client.library("getItem", JSONObject().put("itemId", itemId)) as? JSONObject)?.let(::parseItem)

    /** 这些条目（及其下属各集）的观看进度 */
    fun progress(itemIds: List<Long>): List<LibraryProgress> =
        parseProgress(client.library("progress.list", JSONObject().put("itemIds", JSONArray(itemIds))) as JSONArray)

    /** 上报一次进度；播到结尾时 ended 为真 */
    fun saveProgress(itemId: Long, fileId: Long, position: Double, duration: Double, ended: Boolean) {
        val report = JSONObject()
            .put("itemId", itemId).put("fileId", fileId)
            .put("position", position).put("duration", duration).put("ended", ended)
        client.library("progress.save", JSONObject().put("reports", JSONArray().put(report)))
    }

    /** 视频旁的外挂字幕（同名优先）；取不到不影响播放，按没有处理 */
    fun subtitles(fileId: Long): List<LibrarySubtitle> =
        runCatching { parseSubtitles(JSONObject(client.get("/media/subtitles/$fileId", SUBTITLE_TIMEOUT_MS))) }.getOrDefault(emptyList())

    /** 视频文件的播放地址（Range 流）；播放器要带上 [ServerClient.authorization] */
    fun fileUrl(fileId: Long): String = client.url("/media/files/$fileId")

    /** 外挂字幕的完整地址 */
    fun subtitleUrl(subtitle: LibrarySubtitle): String = client.url(subtitle.url)
}
