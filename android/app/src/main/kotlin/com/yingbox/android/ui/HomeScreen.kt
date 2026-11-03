package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.BrowseTarget
import com.yingbox.android.view.CollectionId
import com.yingbox.android.view.DoubanKind
import com.yingbox.android.view.HomeView
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewCard
import com.yingbox.android.view.ViewCollection
import com.yingbox.android.view.ViewContinue
import com.yingbox.android.view.ViewHeroSlide
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** 首页没取全时的重取间隔（共 1 + 3 次） */
private val HOME_RETRY_MS = longArrayOf(8_000, 30_000, 60_000)

/** 热门三行都有、每张片单都有海报 */
private fun HomeView.isComplete(): Boolean =
    hotMovies != null && hotTv != null && chart != null && collections.all { it.posters.isNotEmpty() }

/** 首页上的点击去向 */
class HomeActions(
    /** 打开豆瓣卡的详情 */
    val openCard: (ViewCard) -> Unit,
    /** 从继续观看记录接着播 */
    val resume: (continueId: String) -> Unit,
    /** 打开浏览页（热门全部、某个类型、某个精选片单） */
    val browse: (BrowseTarget) -> Unit,
)

/**
 * 首页（ADR-0028 v1）：满幅轮播，下面是继续观看、收藏、热门、榜单、按类型浏览、精选片单。
 * 内容卡片一律实色，玻璃只给浮动控件（导航胶囊）。
 */
@Composable
fun HomeScreen(client: ServerClient, scroll: LazyListState, chrome: PaddingValues, actions: HomeActions) {
    val result by produceState<Result<HomeView>?>(null, client) {
        // 豆瓣冷启动偶尔漏行或漏片单海报，服务端对不完整的首页只缓存 30 秒；这里隔一会儿再取，补上缺的
        for (attempt in 0..HOME_RETRY_MS.size) {
            val next = withContext(Dispatchers.IO) { runCatching { ViewApi(client).home() } }
            // 重取失败时保留已经显示的内容
            val old = value?.getOrNull()
            val worse = old != null && old.isComplete() && next.getOrNull()?.isComplete() != true
            if (!worse && (next.isSuccess || old == null)) value = next
            if (next.getOrNull()?.isComplete() == true) return@produceState
            HOME_RETRY_MS.getOrNull(attempt)?.let { delay(it) }
        }
    }
    val home = result
    when {
        home == null -> Message("首页加载中…")
        home.isFailure -> Message("首页加载失败：${home.exceptionOrNull()?.message}")
        else -> HomeRows(home.getOrThrow(), client, scroll, chrome, actions)
    }
}

@Composable
private fun HomeRows(home: HomeView, client: ServerClient, scroll: LazyListState, chrome: PaddingValues, actions: HomeActions) {
    val shelves = listOfNotNull(home.hotMovies, home.hotTv, home.chart)
    val cards = shelves.flatMap { it.items }.associateBy { it.id }
    val openSlide = { slide: ViewHeroSlide ->
        slide.continueId?.let(actions.resume) ?: slide.cardId?.let(cards::get)?.let(actions.openCard)
        Unit
    }
    val bottomPadding = chrome.calculateBottomPadding() + if (LocalIsTv.current) YbSpace.S4 else 0.dp
    LazyColumn(
        state = scroll,
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(bottom = bottomPadding),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
    ) {
        // 轮播铺到最顶上（压在状态栏、电视顶部导航下面），其余行左右留白
        item { if (home.hero.isNotEmpty()) Hero(home.hero, client, scroll, openSlide) else Box(Modifier.padding(chrome)) }
        if (home.continueRow.isNotEmpty()) item { Section("继续观看") { ContinueRow(home.continueRow, client, actions.resume) } }
        if (home.favorites.isNotEmpty()) {
            item { Section("我的收藏") { PosterRow(home.favorites, client, actions.openCard, null) } }
        }
        items(shelves) { shelf ->
            // 热门两行通向「全部」；榜单行没有更多
            val more = if (shelf === home.chart) null else ({ actions.browse(BrowseTarget.Hot(shelf.kind)) })
            Section(shelf.title, more) { PosterRow(shelf.items, client, actions.openCard, more) }
        }
        item { Section("按类型浏览") { Genres(home.genres) { actions.browse(BrowseTarget.Genre(it, DoubanKind.MOVIE)) } } }
        item { Section("精选片单") { Collections(home.collections, client) { actions.browse(BrowseTarget.Collection(it)) } } }
    }
}

@Composable
private fun Section(title: String, more: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val gutter = gutter()
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
        Box(Modifier.padding(horizontal = gutter)) { RowTitle(title, more) }
        content()
    }
}

/** 满幅轮播：剧照铺满，底部渐暗压文字，主按钮白底黑字 */
@Composable
private fun Hero(slides: List<ViewHeroSlide>, client: ServerClient, scroll: LazyListState, open: (ViewHeroSlide) -> Unit) {
    val gutter = gutter()
    val config = LocalConfiguration.current
    val wide = config.screenWidthDp >= 600
    val isTv = LocalIsTv.current
    val height = if (wide) config.screenHeightDp.dp * 0.76f else heroMinHeight()
    val pager = rememberPagerState { slides.size }
    Box(Modifier.fillMaxWidth().height(height)) {
        HorizontalPager(pager, Modifier.fillMaxSize(), key = { slides[it].key }) { page ->
            val slide = slides[page]
            Box(Modifier.fillMaxSize()) {
                RemoteImage(slide.image, client, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(heroScrim()))
                Box(Modifier.fillMaxSize().background(heroSideScrim()))
                Column(
                    Modifier.align(Alignment.BottomStart)
                        .padding(start = gutter, end = gutter, bottom = if (wide) YbSpace.S9 else YbSpace.S8)
                        .fillMaxWidth(if (wide) 0.42f else 1f),
                    verticalArrangement = Arrangement.spacedBy(YbSpace.S2),
                ) {
                    Text(
                        slide.title,
                        color = YbColor.TextPrimary,
                        fontSize = YbText.Xl3,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val meta = listOf(slide.meta, slide.rating).filter { it.isNotEmpty() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, color = YbColor.TextSecondary, fontSize = YbText.Sm)
                    if (slide.overview.isNotEmpty()) {
                        Text(slide.overview, color = YbColor.TextSecondary, fontSize = YbText.Sm, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Box(Modifier.padding(top = YbSpace.S2).onFocusChanged {
                        if (isTv && it.isFocused) scroll.requestScrollToItem(0)
                    }) { PrimaryButton(slide.playLabel, YbIcons.Play) { open(slide) } }
                }
            }
        }
        // 翻页圆点
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = YbSpace.S2)
                .background(YbColor.GlassFallback, YbRadius.Full).padding(horizontal = YbSpace.S2, vertical = YbSpace.S1),
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S1),
        ) {
            repeat(slides.size) { i ->
                Box(
                    Modifier.width(if (i == pager.currentPage) YbSpace.S3 else YbSpace.S1)
                        .height(YbSpace.S1).clip(CircleShape)
                        .background(if (i == pager.currentPage) YbColor.TextPrimary else YbColor.TextTertiary),
                )
            }
        }
    }
}

@Composable
private fun ContinueRow(cards: List<ViewContinue>, client: ServerClient, resume: (String) -> Unit) {
    val gutter = gutter()
    LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S4)) {
        items(cards, key = { it.id }) { card -> ContinueCard(card, client) { resume(card.id) } }
    }
}

/** 一张继续观看横卡：剧照、进度条、片名、集数 */
@Composable
internal fun ContinueCard(card: ViewContinue, client: ServerClient, open: () -> Unit) {
    Column(Modifier.width(240.dp).tvFocusViewport(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).focusFrame(lift = true, onClick = open).clip(YbRadius.Card)) {
            RemoteImage(card.image.orEmpty(), client, Modifier.fillMaxSize())
            if (card.progress > 0) {
                Box(
                    Modifier.align(Alignment.BottomStart).padding(YbSpace.S3).fillMaxWidth().height(4.dp)
                        .clip(YbRadius.Full).background(Color(0x66FFFFFF)),
                ) {
                    Box(Modifier.fillMaxWidth(card.progress.toFloat()).height(4.dp).background(YbColor.TextPrimary))
                }
            }
        }
        Text(card.title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(card.subtitle, color = Muted, fontSize = YbText.Xs, maxLines = 1)
    }
}

@Composable
private fun PosterRow(items: List<ViewCard>, client: ServerClient, open: (ViewCard) -> Unit, more: (() -> Unit)?) {
    val gutter = gutter()
    LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S4)) {
        items(items, key = { it.id }) { card -> Poster(card, client) { open(card) } }
        if (more != null) {
            item(key = "more") {
                Box(
                    Modifier.width(132.dp).aspectRatio(2f / 3f).background(YbColor.Elevated, YbRadius.Card)
                        .tvFocusViewport()
                        .focusFrame(lift = true, onClick = more),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("全部", color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun Genres(genres: List<String>, open: (String) -> Unit) {
    val gutter = gutter()
    LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        items(genres) { genre -> Pill(genre) { open(genre) } }
    }
}

@Composable
private fun Collections(collections: List<ViewCollection>, client: ServerClient, open: (CollectionId) -> Unit) {
    val gutter = gutter()
    LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S4)) {
        items(collections, key = { it.id.json }) { c ->
            Box(Modifier.width(280.dp).aspectRatio(16f / 9f).tvFocusViewport().focusFrame(lift = true) { open(c.id) }.clip(YbRadius.Card)) {
                RemoteImage(c.posters.firstOrNull().orEmpty(), client, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.2f to Color.Transparent, 1f to Color(0xD9000000))))
                Column(Modifier.align(Alignment.BottomStart).padding(YbSpace.S4)) {
                    Text(c.kicker, color = YbColor.TextSecondary, fontSize = YbText.Xs2, fontWeight = FontWeight.SemiBold)
                    Text(c.title, color = YbColor.TextPrimary, fontSize = YbText.Xl, fontWeight = FontWeight.Bold)
                    Text(c.blurb, color = YbColor.TextSecondary, fontSize = YbText.Xs, maxLines = 1)
                }
            }
        }
    }
}
