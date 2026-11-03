package com.yingbox.android.library

/** 片库顶层条目的类型（电影 / 剧集） */
enum class LibraryType(val json: String, val label: String) {
    Movie("movie", "电影"),
    Series("series", "剧集"),
}

/** 海报墙的一格 */
data class LibraryCard(
    val id: Long,
    val type: LibraryType,
    val title: String,
    val year: Int?,
    val rating: Double?,
    val poster: String?,
    val backdrop: String?,
)

/** 一页查询结果；total 是满足条件的总数，不受分页影响 */
data class LibraryPage(val items: List<LibraryCard>, val total: Int)

/**
 * 一个可播放的版本（最好的排在前面）：一个视频文件，或同一文件夹里的一组分段（CD1 / CD2，[fileIds] 按播放顺序）。
 * badge 是「杜比视界 P8」「HDR10」这类动态范围标签，SDR 或没探测过为 null；height 是垂直分辨率，读不出为 null。
 */
data class LibraryVersion(val fileIds: List<Long>, val height: Int?, val badge: String?, val size: Long)

/** 剧集里的一集（已按季、集排好） */
data class LibraryEpisode(
    val itemId: Long,
    val season: Int,
    val episode: Int,
    val title: String,
    val overview: String?,
    val versions: List<LibraryVersion>,
)

/** 条目详情：电影的版本在 [versions]，剧集的版本在各集里 */
data class LibraryItem(
    val card: LibraryCard,
    val overview: String?,
    val runtimeMin: Int?,
    val genres: List<String>,
    val versions: List<LibraryVersion>,
    val episodes: List<LibraryEpisode>,
)

/** 一条观看进度（秒） */
data class LibraryProgress(
    val itemId: Long,
    val fileId: Long?,
    val position: Double,
    val duration: Double,
    val watched: Boolean,
)

/** 视频旁的一条外挂字幕；url 是相对服务根的读取地址，内容是 WebVTT */
data class LibrarySubtitle(val name: String, val url: String)
