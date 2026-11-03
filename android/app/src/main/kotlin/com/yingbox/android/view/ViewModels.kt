// 由 scripts/gen-view-kotlin.ts 从 src/shared/view 生成，不要手改（ADR-0030）。
// 改了视图描述后运行 pnpm gen:view-kotlin。
package com.yingbox.android.view

import org.json.JSONObject

data class HomeView(
    val hero: List<ViewHeroSlide>,
    val continueRow: List<ViewContinue>,
    val favorites: List<ViewCard>,
    val hotMovies: ViewShelf?,
    val hotTv: ViewShelf?,
    val chart: ViewShelf?,
    val genres: List<String>,
    val collections: List<ViewCollection>,
) {
    companion object {
        fun fromJson(json: JSONObject): HomeView = HomeView(
            hero = json.getJSONArray("hero").let { a0 -> List(a0.length()) { i0 -> ViewHeroSlide.fromJson(a0.getJSONObject(i0)) } },
            continueRow = json.getJSONArray("continueRow").let { a0 -> List(a0.length()) { i0 -> ViewContinue.fromJson(a0.getJSONObject(i0)) } },
            favorites = json.getJSONArray("favorites").let { a0 -> List(a0.length()) { i0 -> ViewCard.fromJson(a0.getJSONObject(i0)) } },
            hotMovies = (if (json.isNull("hotMovies")) null else ViewShelf.fromJson(json.getJSONObject("hotMovies"))),
            hotTv = (if (json.isNull("hotTv")) null else ViewShelf.fromJson(json.getJSONObject("hotTv"))),
            chart = (if (json.isNull("chart")) null else ViewShelf.fromJson(json.getJSONObject("chart"))),
            genres = json.getJSONArray("genres").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
            collections = json.getJSONArray("collections").let { a0 -> List(a0.length()) { i0 -> ViewCollection.fromJson(a0.getJSONObject(i0)) } },
        )
    }
}

data class ViewHeroSlide(
    val key: String,
    val kind: HeroKind,
    val kicker: String,
    val title: String,
    val image: String,
    val imageIsPoster: Boolean,
    val overview: String,
    val meta: String,
    val rating: String,
    val playLabel: String,
    val continueId: String?,
    val cardId: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewHeroSlide = ViewHeroSlide(
            key = json.getString("key"),
            kind = HeroKind.fromJson(json.getString("kind")),
            kicker = json.getString("kicker"),
            title = json.getString("title"),
            image = json.getString("image"),
            imageIsPoster = json.getBoolean("imageIsPoster"),
            overview = json.getString("overview"),
            meta = json.getString("meta"),
            rating = json.getString("rating"),
            playLabel = json.getString("playLabel"),
            continueId = (if (json.isNull("continueId")) null else json.getString("continueId")),
            cardId = (if (json.isNull("cardId")) null else json.getString("cardId")),
        )
    }
}

enum class HeroKind(val json: String) {
    RESUME("resume"),
    DOUBAN("douban"),
    ;

    companion object {
        fun fromJson(value: String): HeroKind =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 HeroKind：$value")
    }
}

data class ViewContinue(
    val id: String,
    val section: ContinueSection,
    val title: String,
    val subtitle: String,
    val foot: String,
    val image: String?,
    val poster: String?,
    val progress: Double,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewContinue = ViewContinue(
            id = json.getString("id"),
            section = ContinueSection.fromJson(json.getString("section")),
            title = json.getString("title"),
            subtitle = json.getString("subtitle"),
            foot = json.getString("foot"),
            image = (if (json.isNull("image")) null else json.getString("image")),
            poster = (if (json.isNull("poster")) null else json.getString("poster")),
            progress = json.getDouble("progress"),
        )
    }
}

enum class ContinueSection(val json: String) {
    MOVIE("movie"),
    TV("tv"),
    JAV("jav"),
    ONLINE("online"),
    AV("av"),
    ;

    companion object {
        fun fromJson(value: String): ContinueSection =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 ContinueSection：$value")
    }
}

data class ViewCard(
    val id: String,
    val title: String,
    val searchTitle: String,
    val year: String,
    val rate: String,
    val kind: DoubanKind,
    val poster: String,
    val backdrop: String?,
    val overview: String,
    val doubanUrl: String,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewCard = ViewCard(
            id = json.getString("id"),
            title = json.getString("title"),
            searchTitle = json.getString("searchTitle"),
            year = json.getString("year"),
            rate = json.getString("rate"),
            kind = DoubanKind.fromJson(json.getString("kind")),
            poster = json.getString("poster"),
            backdrop = (if (json.isNull("backdrop")) null else json.getString("backdrop")),
            overview = json.getString("overview"),
            doubanUrl = json.getString("doubanUrl"),
        )
    }
}

enum class DoubanKind(val json: String) {
    MOVIE("movie"),
    TV("tv"),
    ;

    companion object {
        fun fromJson(value: String): DoubanKind =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 DoubanKind：$value")
    }
}

data class ViewShelf(
    val title: String,
    val kind: DoubanKind,
    val items: List<ViewCard>,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewShelf = ViewShelf(
            title = json.getString("title"),
            kind = DoubanKind.fromJson(json.getString("kind")),
            items = json.getJSONArray("items").let { a0 -> List(a0.length()) { i0 -> ViewCard.fromJson(a0.getJSONObject(i0)) } },
        )
    }
}

data class ViewCollection(
    val id: CollectionId,
    val kicker: String,
    val title: String,
    val blurb: String,
    val kind: DoubanKind,
    val posters: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewCollection = ViewCollection(
            id = CollectionId.fromJson(json.getString("id")),
            kicker = json.getString("kicker"),
            title = json.getString("title"),
            blurb = json.getString("blurb"),
            kind = DoubanKind.fromJson(json.getString("kind")),
            posters = json.getJSONArray("posters").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
        )
    }
}

enum class CollectionId(val json: String) {
    TOP("top"),
    GEMS("gems"),
    CHINESE("chinese"),
    KDRAMA("kdrama"),
    ;

    companion object {
        fun fromJson(value: String): CollectionId =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 CollectionId：$value")
    }
}

data class ViewDetail(
    val id: String,
    val kind: DoubanKind,
    val title: String,
    val originalTitle: String,
    val year: String,
    val rating: String,
    val genres: List<String>,
    val countries: List<String>,
    val duration: String,
    val directors: List<String>,
    val actors: List<ViewPerson>,
    val overview: String,
    val poster: String,
    val backdrop: String?,
    val images: List<String>,
    val coverSource: String?,
    val favorite: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewDetail = ViewDetail(
            id = json.getString("id"),
            kind = DoubanKind.fromJson(json.getString("kind")),
            title = json.getString("title"),
            originalTitle = json.getString("originalTitle"),
            year = json.getString("year"),
            rating = json.getString("rating"),
            genres = json.getJSONArray("genres").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
            countries = json.getJSONArray("countries").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
            duration = json.getString("duration"),
            directors = json.getJSONArray("directors").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
            actors = json.getJSONArray("actors").let { a0 -> List(a0.length()) { i0 -> ViewPerson.fromJson(a0.getJSONObject(i0)) } },
            overview = json.getString("overview"),
            poster = json.getString("poster"),
            backdrop = (if (json.isNull("backdrop")) null else json.getString("backdrop")),
            images = json.getJSONArray("images").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
            coverSource = (if (json.isNull("coverSource")) null else json.getString("coverSource")),
            favorite = json.getBoolean("favorite"),
        )
    }
}

data class ViewPerson(
    val name: String,
    val photo: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewPerson = ViewPerson(
            name = json.getString("name"),
            photo = (if (json.isNull("photo")) null else json.getString("photo")),
        )
    }
}

data class ViewSources(
    val sessionId: String,
    val done: Boolean,
    val probing: Boolean,
    val sites: List<ViewSourceSite>,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewSources = ViewSources(
            sessionId = json.getString("sessionId"),
            done = json.getBoolean("done"),
            probing = json.getBoolean("probing"),
            sites = json.getJSONArray("sites").let { a0 -> List(a0.length()) { i0 -> ViewSourceSite.fromJson(a0.getJSONObject(i0)) } },
        )
    }
}

data class ViewSourceSite(
    val siteName: String,
    val kind: SourceKind,
    val lines: List<ViewLine>,
    val status: ProbeStatus,
    val resolution: String,
    val detail: String,
    val fastest: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewSourceSite = ViewSourceSite(
            siteName = json.getString("siteName"),
            kind = SourceKind.fromJson(json.getString("kind")),
            lines = json.getJSONArray("lines").let { a0 -> List(a0.length()) { i0 -> ViewLine.fromJson(a0.getJSONObject(i0)) } },
            status = ProbeStatus.fromJson(json.getString("status")),
            resolution = json.getString("resolution"),
            detail = json.getString("detail"),
            fastest = json.getBoolean("fastest"),
        )
    }
}

enum class SourceKind(val json: String) {
    CATSPIDER("catspider"),
    CMS("cms"),
    ;

    companion object {
        fun fromJson(value: String): SourceKind =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 SourceKind：$value")
    }
}

data class ViewLine(
    val label: String,
    val episodes: List<ViewEpisode>,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewLine = ViewLine(
            label = json.getString("label"),
            episodes = json.getJSONArray("episodes").let { a0 -> List(a0.length()) { i0 -> ViewEpisode.fromJson(a0.getJSONObject(i0)) } },
        )
    }
}

data class ViewEpisode(
    val name: String,
    val url: String,
    val siteName: String?,
    val ext: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewEpisode = ViewEpisode(
            name = json.getString("name"),
            url = json.getString("url"),
            siteName = (if (json.isNull("siteName")) null else json.getString("siteName")),
            ext = (if (json.isNull("ext")) null else json.getString("ext")),
        )
    }
}

enum class ProbeStatus(val json: String) {
    PENDING("pending"),
    OK("ok"),
    FAIL("fail"),
    ;

    companion object {
        fun fromJson(value: String): ProbeStatus =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 ProbeStatus：$value")
    }
}

data class ViewPlayable(
    val url: String,
    val direct: Boolean,
    val hls: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewPlayable = ViewPlayable(
            url = json.getString("url"),
            direct = json.getBoolean("direct"),
            hls = json.getBoolean("hls"),
        )
    }
}

data class ViewResume(
    val continueId: String,
    val title: String,
    val key: String,
    val cover: String?,
    val episodes: List<ViewEpisode>,
    val index: Double,
    val startAt: Double,
    val doubanId: String?,
    val kind: DoubanKind?,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewResume = ViewResume(
            continueId = json.getString("continueId"),
            title = json.getString("title"),
            key = json.getString("key"),
            cover = (if (json.isNull("cover")) null else json.getString("cover")),
            episodes = json.getJSONArray("episodes").let { a0 -> List(a0.length()) { i0 -> ViewEpisode.fromJson(a0.getJSONObject(i0)) } },
            index = json.getDouble("index"),
            startAt = json.getDouble("startAt"),
            doubanId = (if (json.isNull("doubanId")) null else json.getString("doubanId")),
            kind = (if (json.isNull("kind")) null else DoubanKind.fromJson(json.getString("kind"))),
        )
    }
}

data class ViewBrowsePage(
    val title: String,
    val items: List<ViewCard>,
    val next: Double?,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewBrowsePage = ViewBrowsePage(
            title = json.getString("title"),
            items = json.getJSONArray("items").let { a0 -> List(a0.length()) { i0 -> ViewCard.fromJson(a0.getJSONObject(i0)) } },
            next = (if (json.isNull("next")) null else json.getDouble("next")),
        )
    }
}

data class ViewSearchCard(
    val title: String,
    val year: String,
    val tag: String,
    val poster: String,
    val siteCount: Double,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewSearchCard = ViewSearchCard(
            title = json.getString("title"),
            year = json.getString("year"),
            tag = json.getString("tag"),
            poster = json.getString("poster"),
            siteCount = json.getDouble("siteCount"),
        )
    }
}

data class ViewSourceHealth(
    val checking: Boolean,
    val done: Double,
    val total: Double,
    val failed: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewSourceHealth = ViewSourceHealth(
            checking = json.getBoolean("checking"),
            done = json.getDouble("done"),
            total = json.getDouble("total"),
            failed = json.getJSONArray("failed").let { a0 -> List(a0.length()) { i0 -> a0.getString(i0) } },
        )
    }
}

data class ViewAppUpdate(
    val version: String,
    val notes: String,
    val url: String,
    val size: Double,
    val sha256: String,
    val publishedAt: String,
) {
    companion object {
        fun fromJson(json: JSONObject): ViewAppUpdate = ViewAppUpdate(
            version = json.getString("version"),
            notes = json.getString("notes"),
            url = json.getString("url"),
            size = json.getDouble("size"),
            sha256 = json.getString("sha256"),
            publishedAt = json.getString("publishedAt"),
        )
    }
}
