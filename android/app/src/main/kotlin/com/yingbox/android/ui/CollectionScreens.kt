package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewCard
import com.yingbox.android.view.ViewContinue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 「最近播放」：全部继续观看，点卡接着播 */
@Composable
fun RecentScreen(client: ServerClient, chrome: PaddingValues, resume: (String) -> Unit) {
    val result by produceState<Result<List<ViewContinue>>?>(null, client) {
        value = withContext(Dispatchers.IO) { runCatching { ViewApi(client).recent() } }
    }
    CollectionGrid("最近播放", result, "还没有播放记录", 132.dp, chrome) { card ->
        ContinuePoster(card, client) { resume(card.id) }
    }
}

/** 最近播放里的一张竖版海报卡：进度条压在海报底部，下面是片名和集数；没有海报时退回横版封面 */
@Composable
private fun ContinuePoster(card: ViewContinue, client: ServerClient, open: () -> Unit) {
    Column(Modifier.width(132.dp).tvFocusViewport(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).focusFrame(lift = true, onClick = open).clip(YbRadius.Card)) {
            RemoteImage(card.poster ?: card.image.orEmpty(), client, Modifier.fillMaxSize())
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
        Text(card.subtitle, color = Muted, fontSize = YbText.Xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 「我的收藏」：全部收藏，点卡进详情 */
@Composable
fun FavoritesScreen(client: ServerClient, chrome: PaddingValues, open: (ViewCard) -> Unit) {
    val result by produceState<Result<List<ViewCard>>?>(null, client) {
        value = withContext(Dispatchers.IO) { runCatching { ViewApi(client).favorites() } }
    }
    CollectionGrid("收藏", result, "还没有收藏，在详情页点「收藏」", 132.dp, chrome) { card ->
        Poster(card, client) { open(card) }
    }
}

@Composable
private fun <T> CollectionGrid(
    title: String,
    result: Result<List<T>>?,
    empty: String,
    cell: Dp,
    chrome: PaddingValues,
    content: @Composable (T) -> Unit,
) {
    val dir = LocalLayoutDirection.current
    LazyVerticalGrid(
        columns = GridCells.Adaptive(cell),
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(
            start = gutter() + chrome.calculateStartPadding(dir),
            end = gutter() + chrome.calculateEndPadding(dir),
            top = chrome.calculateTopPadding(),
            bottom = chrome.calculateBottomPadding(),
        ),
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S6),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) { PageTitle(title) }
        val list = result?.getOrNull()
        when {
            result == null -> item(span = { GridItemSpan(maxLineSpan) }) { Text("加载中…", color = Muted, fontSize = YbText.Sm) }
            list == null -> item(span = { GridItemSpan(maxLineSpan) }) { Text("加载失败", color = Muted, fontSize = YbText.Sm) }
            list.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { Text(empty, color = Muted, fontSize = YbText.Sm) }
            else -> items(list) { content(it) }
        }
    }
}
