package com.yingbox.android.playback

import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.DoubanKind
import com.yingbox.android.view.ViewEpisode
import org.json.JSONArray
import org.json.JSONObject

/** 一部片开播时的身份：登记继续观看用 */
data class PlayTitle(
    val title: String,
    /** 继续观看的 key：在线按片名合并（与桌面一致），从记录续播时沿用记录的 key */
    val key: String = title,
    val cover: String?,
    val doubanId: String?,
    val kind: DoubanKind?,
)

/**
 * 播放记录（ADR-0031）的写入：继续观看。读取走 ViewApi.resume。阻塞调用，不要放主线程。
 * 无痕模式下不要调用（无痕是客户端状态）。
 */
class PlaybackApi(private val client: ServerClient) {
    /** 开播登记，返回记录 id */
    fun continueStart(title: PlayTitle, episodes: List<ViewEpisode>, index: Int): String {
        val meta = JSONObject()
            .put("section", "online")
            .put("key", title.key)
            .put("title", title.title)
        title.cover?.let { meta.put("cover", it) }
        if (title.doubanId != null) {
            meta.put("detail", JSONObject().put("doubanId", title.doubanId).put("kind", title.kind?.json))
        }
        val playlist = JSONArray()
        for (ep in episodes) {
            val entry = JSONObject().put("url", ep.url).put("name", ep.name)
            ep.siteName?.let { entry.put("siteName", it) }
            ep.ext?.let { entry.put("ext", JSONObject(it)) }
            playlist.put(entry)
        }
        val replay = JSONObject().put("playlist", playlist).put("index", index)
        return client.call("playback", "continueStart", JSONArray().put(meta).put(replay).put(0)) as String
    }

    /** 记一次进度；ended 表示这一集播完（有下一集会换成「下一集」，最后一集移除记录） */
    fun continueProgress(id: String, index: Int, episode: String, progress: Double, duration: Double, ended: Boolean) {
        val update = JSONObject()
            .put("index", index)
            .put("episode", episode)
            .put("progress", progress.coerceAtLeast(0.0))
            .put("duration", duration.coerceAtLeast(0.0))
            .put("ended", ended)
        client.call("playback", "continueProgress", JSONArray().put(id).put(update))
    }
}
