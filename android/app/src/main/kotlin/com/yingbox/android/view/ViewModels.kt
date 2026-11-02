// 由 scripts/gen-view-kotlin.ts 从 src/shared/view 生成，不要手改（ADR-0030）。
// 改了视图描述后运行 pnpm gen:view-kotlin。
package com.yingbox.android.view

import org.json.JSONObject

data class HomeView(
    val hero: List<ViewHeroSlide>,
    val continueRow: List<ViewContinue>,
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
