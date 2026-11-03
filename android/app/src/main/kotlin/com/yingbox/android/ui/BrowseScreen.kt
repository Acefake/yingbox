package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.BrowseTarget
import com.yingbox.android.view.CollectionId
import com.yingbox.android.view.DoubanKind
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewCard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 离末尾还剩这么多张时取下一页 */
private const val PREFETCH = 8

/** 一个目标的浏览状态 */
private class Feed {
    var items by mutableStateOf(listOf<ViewCard>())

    /** 下一页的 start；null 到底 */
    var next by mutableStateOf<Int?>(0)
    var loading by mutableStateOf(false)
    var failed by mutableStateOf(false)
}

/**
 * 浏览页（view.browse）：热门、某个类型或某个精选片单的海报网格，快到底时取下一页，按 id 去重。
 * 热门和类型页可以在电影、剧集之间切换。
 */
@Composable
fun BrowseScreen(client: ServerClient, initial: BrowseTarget, open: (ViewCard) -> Unit) {
    val api = remember(client) { ViewApi(client) }
    var target by remember { mutableStateOf(initial) }
    val feed = remember(target) { Feed() }
    val grid = rememberLazyGridState()
    // 加载放在页面作用域里：滚动时触发条件抖动不会取消在途请求（取消了也停不下阻塞的 HTTP 调用，只会重发）
    val scope = rememberCoroutineScope()
    val firstCard = remember { FocusRequester() }

    /** 给 f 取下一页；t 是 f 对应的目标（切换后旧请求晚到也只写进旧的 f） */
    suspend fun load(f: Feed, t: BrowseTarget) {
        val start = f.next ?: return
        if (f.loading || f.failed) return
        f.loading = true
        try {
            val page = withContext(Dispatchers.IO) { api.browse(t, start) }
            f.items = (f.items + page.items).distinctBy { it.id }
            f.next = page.next?.toInt()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            f.failed = true
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
    LaunchedEffect(feed, nearEnd, feed.next, feed.failed) {
        if (nearEnd && !feed.loading) {
            val f = feed
            val t = target
            scope.launch { load(f, t) }
        }
    }
    // 遥控器进来就能操作：第一页到了，焦点落在第一张海报上
    val hasItems = feed.items.isNotEmpty()
    LaunchedEffect(feed, hasItems) {
        if (hasItems) runCatching { firstCard.requestFocus() }
    }

    val kind = when (val t = target) {
        is BrowseTarget.Hot -> t.kind
        is BrowseTarget.Genre -> t.kind
        is BrowseTarget.Collection -> null
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(132.dp),
        state = grid,
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        // 顶部让出状态栏和左上角的返回圆钮
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = belowBackButton(), bottom = YbSpace.S7),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.padding(end = YbSpace.S4)) { PageTitle(titleOf(target)) }
                if (kind != null) {
                    for ((k, label) in listOf(DoubanKind.MOVIE to "电影", DoubanKind.TV to "剧集")) {
                        Pill(label, selected = k == kind) {
                            target = when (val t = target) {
                                is BrowseTarget.Hot -> t.copy(kind = k)
                                is BrowseTarget.Genre -> t.copy(kind = k)
                                is BrowseTarget.Collection -> t
                            }
                        }
                    }
                }
            }
        }
        itemsIndexed(feed.items, key = { _, card -> card.id }) { i, card ->
            val focus = if (i == 0) Modifier.focusRequester(firstCard) else Modifier
            Poster(card, client, focus) { open(card) }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            val status = when {
                feed.failed -> "加载失败"
                feed.loading -> "加载中…"
                feed.next == null && feed.items.isEmpty() -> "没有找到内容"
                feed.next == null -> "到底了"
                else -> ""
            }
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
                if (status.isNotEmpty()) Text(status, color = Muted, fontSize = YbText.Sm)
                if (feed.failed) Pill("重试") { feed.failed = false }
            }
        }
    }
}

/** 页面标题（与 shared/douban/browse.ts 的 browseTitle 相同），不用等第一页 */
private fun titleOf(target: BrowseTarget): String = when (target) {
    is BrowseTarget.Hot -> "全部"
    is BrowseTarget.Genre -> target.genre
    is BrowseTarget.Collection -> COLLECTION_TITLES[target.id] ?: ""
}

/** 精选片单的标题（与 shared/douban/collections.ts 的 COLLECTIONS 一致） */
private val COLLECTION_TITLES = mapOf(
    CollectionId.TOP to "豆瓣高分",
    CollectionId.GEMS to "冷门佳片",
    CollectionId.CHINESE to "华语热门",
    CollectionId.KDRAMA to "韩剧热播",
)
