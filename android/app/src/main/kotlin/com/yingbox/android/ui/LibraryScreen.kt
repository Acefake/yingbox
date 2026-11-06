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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.library.LibraryApi
import com.yingbox.android.library.LibraryCard
import com.yingbox.android.library.LibraryType
import com.yingbox.android.server.ServerClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 一页取多少张 */
private const val PAGE = 60

/** 离末尾还剩这么多张时取下一页 */
private const val PREFETCH = 12

/** 停止输入这么久才搜索 */
private const val SEARCH_DEBOUNCE_MS = 400L

/** 一个（类型、关键词）的浏览状态 */
internal class LibraryFeed {
    var items by mutableStateOf(listOf<LibraryCard>())
    var total by mutableStateOf(0)
    var loading by mutableStateOf(false)
    var failed by mutableStateOf<String?>(null)
    var loaded by mutableStateOf(false)
}

/** 片库页的浏览状态：提到页面栈外，点进详情再返回时类型、搜索词、已加载的海报和滚动位置都还在 */
class LibraryBrowse {
    var type by mutableStateOf(LibraryType.Movie)
    var search by mutableStateOf("")
    var query by mutableStateOf("")
    internal val feeds = HashMap<Pair<LibraryType, String>, LibraryFeed>()
    internal val grid = LazyGridState()
}

/**
 * NAS 片库（ADR-0040）：电影、剧集海报墙，按片名搜索，快到底时取下一页。
 * 连不上或令牌不对时给出原因，并提供「去设置」。
 */
@Composable
fun LibraryScreen(nas: ServerClient, browse: LibraryBrowse, chrome: PaddingValues, openSettings: () -> Unit, open: (LibraryCard) -> Unit) {
    val api = remember(nas) { LibraryApi(nas) }
    val type = browse.type
    val search = browse.search
    val query = browse.query
    val grid = browse.grid
    val scope = rememberCoroutineScope()
    /** 换了类型或关键词：回到第一行 */
    fun switchTo(newType: LibraryType, newQuery: String) {
        browse.type = newType
        browse.query = newQuery
        scope.launch { grid.scrollToItem(0) }
    }
    LaunchedEffect(search) {
        delay(SEARCH_DEBOUNCE_MS)
        // 回到这一页时 search 没变，query 也不变，不会把滚动位置重置
        if (search.trim() != browse.query) switchTo(browse.type, search.trim())
    }
    val feed = browse.feeds.getOrPut(type to query) { LibraryFeed() }

    /** 给 f 取下一页；切换类型或关键词后旧请求晚到也只写进旧的 f */
    suspend fun load(f: LibraryFeed, t: LibraryType, q: String) {
        if (f.loading || f.failed != null || (f.loaded && f.items.size >= f.total)) return
        f.loading = true
        try {
            val page = withContext(Dispatchers.IO) { api.query(t, q, f.items.size, PAGE) }
            f.items = (f.items + page.items).distinctBy { it.id }
            f.total = page.total
            f.loaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            f.failed = libraryErrorText(e)
        } finally {
            f.loading = false
        }
    }

    val nearEnd by remember(feed) {
        derivedStateOf {
            val last = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= feed.items.size - PREFETCH
        }
    }
    LaunchedEffect(feed, nearEnd, feed.items.size, feed.failed) {
        if (nearEnd && !feed.loading) {
            val f = feed
            val t = type
            val q = query
            scope.launch { load(f, t, q) }
        }
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(132.dp),
        state = grid,
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(
            start = gutter(),
            end = gutter(),
            top = chrome.calculateTopPadding(),
            bottom = chrome.calculateBottomPadding() + YbSpace.S7,
        ),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                PageTitle("片库")
                Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2), verticalAlignment = Alignment.CenterVertically) {
                    for (option in LibraryType.entries) Pill(option.label, selected = option == type) { switchTo(option, query) }
                }
                Box(
                    Modifier.fillMaxWidth().height(44.dp).background(YbColor.FillSecondary, YbRadius.Full).padding(horizontal = YbSpace.S4),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    RemoteTextField(
                        value = search,
                        onChange = { browse.search = it },
                        placeholder = "搜索片名",
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        onAction = { switchTo(type, search.trim()) },
                    )
                }
            }
        }
        itemsIndexed(feed.items, key = { _, card -> card.id }) { _, card -> LibraryPoster(card, nas) { open(card) } }
        item(span = { GridItemSpan(maxLineSpan) }) {
            val status = when {
                feed.failed != null -> feed.failed.orEmpty()
                feed.loading -> "加载中…"
                feed.loaded && feed.items.isEmpty() -> if (query.isEmpty()) "片库里还没有${type.label}" else "没有找到「$query」"
                else -> ""
            }
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
                if (status.isNotEmpty()) Text(status, color = Muted, fontSize = YbText.Sm)
                if (feed.failed != null) {
                    Pill("重试") { feed.failed = null }
                    Pill("去设置", onClick = openSettings)
                }
            }
        }
    }
}

/** 片库里的一张竖版海报卡：海报、片名、年份 · 评分 */
@Composable
internal fun LibraryPoster(card: LibraryCard, nas: ServerClient, open: () -> Unit) {
    Column(Modifier.width(132.dp).tvFocusViewport(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        if (card.poster != null) {
            RemoteImage(card.poster, nas, Modifier.fillMaxWidth().aspectRatio(2f / 3f).focusFrame(lift = true, onClick = open).clip(YbRadius.Card))
        } else {
            Box(
                Modifier.fillMaxWidth().aspectRatio(2f / 3f).background(YbColor.Elevated, YbRadius.Card).focusFrame(lift = true, onClick = open).padding(YbSpace.S2),
                contentAlignment = Alignment.Center,
            ) { Text(card.title, color = Muted, fontSize = YbText.Sm, maxLines = 4, overflow = TextOverflow.Ellipsis) }
        }
        Text(card.title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            card.year?.toString().orEmpty(),
            color = Muted,
            fontSize = YbText.Xs,
        )
        RatingBadge(card.rating?.toString().orEmpty(), source = card.ratingSource)
    }
}
