package com.yingbox.android.view

import com.yingbox.android.server.ServerClient
import org.json.JSONArray
import org.json.JSONObject

/** 视图域（ADR-0030）：服务端拼好的页面数据。阻塞调用，不要放主线程。 */
class ViewApi(private val client: ServerClient) {
    fun home(): HomeView = HomeView.fromJson(client.call("view", "home") as JSONObject)

    /** 「最近播放」整页 */
    fun recent(): List<ViewContinue> =
        (client.call("view", "recent") as JSONArray).let { a -> List(a.length()) { ViewContinue.fromJson(a.getJSONObject(it)) } }

    /** 「我的收藏」整页 */
    fun favorites(): List<ViewCard> =
        (client.call("view", "favorites") as JSONArray).let { a -> List(a.length()) { ViewCard.fromJson(a.getJSONObject(it)) } }

    /** 在线源体检的进度与结果（服务启动时自动跑一轮：通的启用、不通的停用） */
    fun sourceHealth(): ViewSourceHealth =
        ViewSourceHealth.fromJson(client.call("view", "sourceHealth") as JSONObject)

    /** 重新检测全部源（已在检测中就复用），返回当前进度 */
    fun recheckSources(): ViewSourceHealth =
        ViewSourceHealth.fromJson(client.call("view", "recheckSources") as JSONObject)

    /** 不再使用的站点名 */
    fun blockedSites(): List<String> =
        (client.call("view", "blockedSites") as JSONArray).let { a -> List(a.length()) { a.getString(it) } }

    /** 屏蔽（on 为真）或恢复一个站点，返回最新的屏蔽列表；选源、搜索、自动换源都跳过被屏蔽的站点 */
    fun blockSite(name: String, on: Boolean): List<String> =
        (client.call("view", "blockSite", JSONArray().put(name).put(on)) as JSONArray).let { a -> List(a.length()) { a.getString(it) } }

    /** 搜索：关键词在各站点里搜，片名相同的合成一张卡（最多等 12 秒） */
    fun search(keyword: String): List<ViewSearchCard> =
        (client.call("view", "search", JSONArray().put(keyword)) as JSONArray).let { a -> List(a.length()) { ViewSearchCard.fromJson(a.getJSONObject(it)) } }

    /** 浏览页的一页；start 是豆瓣分页位置，第一页为 0 */
    fun browse(target: BrowseTarget, start: Int): ViewBrowsePage =
        ViewBrowsePage.fromJson(client.call("view", "browse", JSONArray().put(target.toJson()).put(start)) as JSONObject)

    /** 豆瓣详情；取不到为 null */
    fun detail(doubanId: String, kind: DoubanKind): ViewDetail? =
        (client.call("view", "detail", JSONArray().put(doubanId).put(kind.json)) as? JSONObject)
            ?.let(ViewDetail::fromJson)

    /** 收藏 / 取消收藏，返回之后是否已收藏 */
    fun favorite(doubanId: String, kind: DoubanKind, on: Boolean): Boolean =
        client.call("view", "favorite", JSONArray().put(doubanId).put(kind.json).put(on)) as Boolean

    /** 开始按片名选源（同一部片 10 分钟内复用会话） */
    fun sourcesStart(title: String): ViewSources =
        ViewSources.fromJson(client.call("view", "sourcesStart", JSONArray().put(title)) as JSONObject)

    /** 会话的当前结果；过期为 null */
    fun sources(sessionId: String): ViewSources? =
        (client.call("view", "sources", JSONArray().put(sessionId)) as? JSONObject)?.let(ViewSources::fromJson)

    /** 一条继续观看记录的续播信息 */
    fun resume(continueId: String): ViewResume? =
        (client.call("view", "resume", JSONArray().put(continueId)) as? JSONObject)?.let(ViewResume::fromJson)

    /** 解析一集的播放地址（本服务的播放代理路径） */
    fun resolve(episode: ViewEpisode): ViewPlayable =
        ViewPlayable.fromJson(client.call("view", "resolve", JSONArray().put(episode.toJson())) as JSONObject)
}

/** 浏览页显示什么（与 shared/douban/browse.ts 的 BrowseTarget 同形状） */
sealed interface BrowseTarget {
    fun toJson(): JSONObject

    /** 热门（全部类型） */
    data class Hot(val kind: DoubanKind) : BrowseTarget {
        override fun toJson(): JSONObject = JSONObject().put("type", "hot").put("kind", kind.json)
    }

    /** 某个类型 */
    data class Genre(val genre: String, val kind: DoubanKind) : BrowseTarget {
        override fun toJson(): JSONObject = JSONObject().put("type", "genre").put("genre", genre).put("kind", kind.json)
    }

    /** 某个精选片单 */
    data class Collection(val id: CollectionId) : BrowseTarget {
        override fun toJson(): JSONObject = JSONObject().put("type", "list").put("list", id.json)
    }
}

/** 交回服务端的剧集（与 ViewEpisode 同形状） */
fun ViewEpisode.toJson(): JSONObject = JSONObject()
    .put("name", name)
    .put("url", url)
    .put("siteName", siteName ?: JSONObject.NULL)
    .put("ext", ext ?: JSONObject.NULL)
