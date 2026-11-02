package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.HomeView
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewCard
import com.yingbox.android.view.ViewCollection
import com.yingbox.android.view.ViewContinue
import com.yingbox.android.view.ViewHeroSlide
import com.yingbox.android.view.ViewShelf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val Muted = Color(0xFF8E8E93)
private val CardShape = RoundedCornerShape(8.dp)

/**
 * 首页（ADR-0028 v1 的起点）：按 view.home 的行渲染，焦点用白框标出。
 * 点击、详情、继续观看后续接入；这里先验证「服务端拼好、原生端只展示」这条链路。
 */
@Composable
fun HomeScreen(client: ServerClient) {
    val result by produceState<Result<HomeView>?>(null, client) {
        value = withContext(Dispatchers.IO) { runCatching { ViewApi(client).home() } }
    }
    val home = result
    when {
        home == null -> Message("首页加载中…")
        home.isFailure -> Message("首页加载失败：${home.exceptionOrNull()?.message}")
        else -> HomeRows(home.getOrThrow(), client)
    }
}

@Composable
private fun HomeRows(home: HomeView, client: ServerClient) {
    val shelves = listOfNotNull(home.hotMovies, home.hotTv, home.chart)
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentPadding = PaddingValues(horizontal = 48.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        if (home.hero.isNotEmpty()) item { Hero(home.hero, client) }
        if (home.continueRow.isNotEmpty()) item { ContinueRow(home.continueRow, client) }
        items(shelves) { shelf -> Shelf(shelf, client) }
        item { Genres(home.genres) }
        item { Collections(home.collections, client) }
    }
}

@Composable
private fun Hero(slides: List<ViewHeroSlide>, client: ServerClient) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        items(slides, key = { it.key }) { slide ->
            Box(Modifier.width(640.dp).height(320.dp).focusFrame()) {
                RemoteImage(slide.image, client, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Color(0x99000000)))
                Column(
                    Modifier.align(Alignment.BottomStart).padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(slide.kicker, color = Color(0xFFD1D1D6), fontSize = 13.sp)
                    Text(slide.title, color = Color.White, fontSize = 28.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val meta = listOf(slide.meta, slide.rating).filter { it.isNotEmpty() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, color = Muted, fontSize = 13.sp)
                    if (slide.overview.isNotEmpty()) {
                        Text(slide.overview, color = Color(0xFFD1D1D6), fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Box(Modifier.padding(top = 8.dp).background(Color.White, CardShape).padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(slide.playLabel, color = Color.Black, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ContinueRow(cards: List<ViewContinue>, client: ServerClient) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RowTitle("继续观看")
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(cards, key = { it.id }) { card ->
                Column(Modifier.width(240.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).focusFrame()) {
                        RemoteImage(card.image.orEmpty(), client, Modifier.fillMaxSize())
                        if (card.progress > 0) {
                            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color(0x66FFFFFF)))
                            Box(
                                Modifier.align(Alignment.BottomStart).fillMaxWidth(card.progress.toFloat())
                                    .height(4.dp).background(Color.White),
                            )
                        }
                    }
                    Text(card.title, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(card.subtitle, color = Muted, fontSize = 12.sp, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun Shelf(shelf: ViewShelf, client: ServerClient) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RowTitle(shelf.title)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(shelf.items, key = { it.id }) { card -> Poster(card, client) }
        }
    }
}

@Composable
private fun Poster(card: ViewCard, client: ServerClient) {
    Column(Modifier.width(132.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RemoteImage(
            card.poster,
            client,
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).focusFrame(),
        )
        Text(card.title, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(listOf(card.year, card.rate).filter { it.isNotEmpty() }.joinToString(" · "), color = Muted, fontSize = 12.sp)
    }
}

@Composable
private fun Genres(genres: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RowTitle("按类型浏览")
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(genres) { genre ->
                Box(
                    Modifier.focusFrame().background(Color(0xFF1C1C1E), CardShape)
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                ) {
                    Text(genre, color = Color.White, fontSize = 16.sp)
                }
            }
        }
    }
}

@Composable
private fun Collections(collections: List<ViewCollection>, client: ServerClient) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RowTitle("精选片单")
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(collections, key = { it.id.json }) { c ->
                Box(Modifier.width(280.dp).height(158.dp).focusFrame()) {
                    RemoteImage(c.posters.firstOrNull().orEmpty(), client, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Color(0x99000000)))
                    Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                        Text(c.kicker, color = Muted, fontSize = 11.sp)
                        Text(c.title, color = Color.White, fontSize = 20.sp)
                        Text(c.blurb, color = Color(0xFFD1D1D6), fontSize = 12.sp, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun RowTitle(text: String) {
    Text(text, color = Color.White, fontSize = 22.sp)
}

@Composable
private fun Message(text: String) {
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Text(text, color = Muted, fontSize = 16.sp)
    }
}

/** 可聚焦（遥控器方向键能走到），聚焦时白框；点击后续接入详情。 */
@Composable
private fun Modifier.focusFrame(): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    return this
        .clip(CardShape)
        .border(if (focused) 3.dp else 0.dp, if (focused) Color.White else Color.Transparent, CardShape)
        .clickable(interactionSource = interaction, indication = null) {}
}
