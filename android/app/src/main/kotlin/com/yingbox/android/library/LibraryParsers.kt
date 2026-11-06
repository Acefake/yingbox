package com.yingbox.android.library

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import com.yingbox.android.playback.engine.FileVideoProbe
import com.yingbox.android.playback.engine.HdrKind

private const val MEDIA_IMAGE_PREFIX = "yingbox-media://image/"

/** 海报墙一格的海报宽度、详情背景宽度（服务端缩略图的档位） */
private const val POSTER_WIDTH = 300
private const val BACKDROP_WIDTH = 780

/**
 * 片库里的图片地址 → NAS 服务上的图片路径（相对服务根，用 NAS 的 [com.yingbox.android.server.ServerClient] 取）：
 * 已缓存的 `yingbox-media://image/<key>` 是 `/media/image/<key>?w=`，远程 http(s) 地址由 NAS 代取缩放
 * （`/media/thumb?w=&src=`），其余（空、别的协议）为 null。
 */
fun mediaImageUrl(raw: String?, width: Int): String? = when {
    raw.isNullOrEmpty() -> null
    raw.startsWith(MEDIA_IMAGE_PREFIX) -> "/media/image/${raw.removePrefix(MEDIA_IMAGE_PREFIX).substringBefore('?')}?w=$width"
    raw.startsWith("http://") || raw.startsWith("https://") -> "/media/thumb?w=$width&src=${URLEncoder.encode(raw, "UTF-8")}"
    else -> null
}

private fun JSONObject.optString2(name: String): String? =
    if (isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }

private fun JSONObject.optInt2(name: String): Int? = if (isNull(name) || !has(name)) null else optInt(name)

private fun JSONObject.optDouble2(name: String): Double? = if (isNull(name) || !has(name)) null else optDouble(name)

private fun typeOf(json: JSONObject): LibraryType =
    LibraryType.entries.firstOrNull { it.json == json.optString("type") } ?: LibraryType.Movie

private fun card(json: JSONObject): LibraryCard = LibraryCard(
    id = json.getLong("id"),
    type = typeOf(json),
    title = json.optString("title"),
    year = json.optInt2("year"),
    rating = json.optDouble2("rating"),
    ratingSource = json.optString2("ratingSource"),
    poster = mediaImageUrl(json.optString2("poster"), POSTER_WIDTH),
    backdrop = mediaImageUrl(json.optString2("backdrop"), BACKDROP_WIDTH),
)

/** `query` 的结果 → 一页海报墙 */
fun parseQuery(json: JSONObject): LibraryPage {
    val items = json.getJSONArray("items")
    return LibraryPage(List(items.length()) { card(items.getJSONObject(it)) }, json.optInt("total"))
}

/** 动态范围标签：杜比视界带 profile，SDR 与没探测过的不出标签 */
private fun badge(range: String?, dvProfile: Int?): String? = when (range) {
    "dv" -> dvProfile?.let { "杜比视界 P$it" } ?: "杜比视界"
    "hdr10" -> "HDR10"
    "hlg" -> "HLG"
    else -> null
}

private fun fileProbe(file: JSONObject): FileVideoProbe? {
    val id = file.optLong("id").takeIf { it > 0 } ?: return null
    val video = file.optJSONObject("video") ?: return null
    val hdr = when (video.optString("range")) {
        "dv" -> HdrKind.DolbyVision
        "hdr10" -> HdrKind.Hdr10
        "hlg" -> HdrKind.Hlg
        "sdr" -> HdrKind.Sdr
        else -> return null
    }
    fun integer(name: String, range: IntRange): Int? {
        val value = (video.opt(name) as? Number)?.toDouble() ?: return null
        return value.takeIf { it.isFinite() && it % 1 == 0.0 && it in range.first.toDouble()..range.last.toDouble() }?.toInt()
    }
    return FileVideoProbe(id, hdr, integer("dvProfile", 0..10), integer("dvCompat", 0..15))
}

/**
 * 可播放的版本：服务端给的 `versions`（已按分辨率、动态范围、体积排好，第一个是默认；分段在同一个版本里）。
 * 没有 `versions` 的旧服务退回到每个视频文件一个版本。
 */
private fun versionsOf(json: JSONObject): List<LibraryVersion> {
    val files = json.optJSONArray("files")
    // 文件 id → 探测结果，杜比视界 profile 只在这里
    val videos = mutableMapOf<Long, JSONObject>()
    if (files != null) {
        for (i in 0 until files.length()) {
            val file = files.getJSONObject(i)
            if (file.optString("kind") == "video") videos[file.getLong("id")] = file
        }
    }
    val versions = json.optJSONArray("versions")
    if (versions != null && versions.length() > 0) {
        return List(versions.length()) {
            val v = versions.getJSONObject(it)
            val ids = v.getJSONArray("fileIds").let { a -> List(a.length()) { i -> a.getLong(i) } }
            val dvProfile = videos[ids.firstOrNull()]?.optJSONObject("video")?.optInt2("dvProfile")
            val probes = ids.mapNotNull { id -> videos[id]?.let(::fileProbe)?.let { id to it } }.toMap()
            LibraryVersion(ids, v.optInt2("height"), badge(v.optString2("range"), dvProfile), v.optLong("size"), probes)
        }
    }
    return videos.map { (id, file) ->
        val video = file.optJSONObject("video")
        val probes = fileProbe(file)?.let { mapOf(id to it) }.orEmpty()
        LibraryVersion(listOf(id), null, badge(video?.optString2("range"), video?.optInt2("dvProfile")), file.optLong("size"), probes)
    }
}

/** 版本按钮上的文字：「2160p · 杜比视界 P8 · 8.4 GB」，分段的加「2 段」 */
fun versionLabel(version: LibraryVersion): String = listOfNotNull(
    version.height?.let { "${it}p" },
    version.badge,
    "%.1f GB".format(version.size / 1_073_741_824.0),
    version.fileIds.size.takeIf { it > 1 }?.let { "$it 段" },
).joinToString(" · ")

private fun episodes(json: JSONObject): List<LibraryEpisode> {
    val out = mutableListOf<LibraryEpisode>()
    fun walk(node: JSONObject, seasonOfParent: Int?) {
        val children = node.optJSONArray("children") ?: return
        for (i in 0 until children.length()) {
            val child = children.getJSONObject(i)
            when (child.optString("type")) {
                "season" -> walk(child, child.optInt2("seasonNumber"))
                "episode" -> out += LibraryEpisode(
                    itemId = child.getLong("id"),
                    season = child.optInt2("seasonNumber") ?: seasonOfParent ?: 1,
                    episode = child.optInt2("episodeNumber") ?: 0,
                    title = child.optString("title"),
                    overview = child.optString2("overview"),
                    versions = versionsOf(child),
                )
            }
        }
    }
    walk(json, null)
    return out.sortedWith(compareBy({ it.season }, { it.episode }))
}

/** `getItem` 的结果（电影或剧集的详情树）→ 详情 */
fun parseItem(json: JSONObject): LibraryItem {
    val genres = json.optJSONArray("genres")
    return LibraryItem(
        card = card(json),
        overview = json.optString2("overview"),
        runtimeMin = json.optInt2("runtime"),
        genres = if (genres == null) emptyList() else List(genres.length()) { genres.getString(it) },
        versions = versionsOf(json),
        episodes = episodes(json),
    )
}

/** `progress.list` / `progress.save` 的结果 */
fun parseProgress(json: JSONArray): List<LibraryProgress> = List(json.length()) {
    val p = json.getJSONObject(it)
    LibraryProgress(
        itemId = p.getLong("itemId"),
        fileId = if (p.isNull("fileId")) null else p.getLong("fileId"),
        position = p.optDouble("position"),
        duration = p.optDouble("duration"),
        watched = p.optBoolean("watched"),
    )
}

/** `/media/subtitles/<fileId>` 的结果 */
fun parseSubtitles(json: JSONObject): List<LibrarySubtitle> {
    val list = json.optJSONArray("subtitles") ?: return emptyList()
    return List(list.length()) {
        val s = list.getJSONObject(it)
        LibrarySubtitle(s.optString("name"), s.getString("url"))
    }
}
