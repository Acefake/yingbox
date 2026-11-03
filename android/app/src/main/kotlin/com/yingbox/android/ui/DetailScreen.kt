package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.PlayTitle
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.DoubanKind
import com.yingbox.android.view.SourceKind
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewDetail
import com.yingbox.android.view.ViewLine
import com.yingbox.android.view.ViewSourceSite
import com.yingbox.android.view.ViewSources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 打开详情需要的身份：豆瓣卡带豆瓣 ID；搜索结果只有片名（豆瓣 ID 与类型为空，不取豆瓣详情、不能收藏） */
data class DetailTarget(
    val doubanId: String?,
    val kind: DoubanKind?,
    val title: String,
    /** 搜源用的片名（TMDB 找到时是中文名） */
    val searchTitle: String,
    /** 详情还没取到时先显示的海报 */
    val poster: String,
    /** 卡片自带的剧照（有就让详情头部一开始就用剧照版式） */
    val backdrop: String? = null,
)

/** 站点在列表里的身份：插件源和 CMS 源可能重名 */
private val ViewSourceSite.key: String get() = "${kind.json}:$siteName"

/** 选源轮询间隔 */
private const val POLL_MS = 800L

/**
 * 详情页：豆瓣详情（view.detail）+ 选源（view.sourcesStart / view.sources 轮询，边搜边出）。
 * 选站点 → 线路 → 集，点集开播。
 */
@Composable
fun DetailScreen(client: ServerClient, target: DetailTarget, scroll: LazyListState, play: (PlayRequest) -> Unit) {
    val api = remember(client) { ViewApi(client) }
    // 详情取到（或确定取不到）之前不让点集：登记继续观看要用它的封面
    val detail by produceState<Result<ViewDetail?>?>(null, target) {
        val id = target.doubanId
        val kind = target.kind
        value = if (id == null || kind == null) Result.success(null) else withContext(Dispatchers.IO) { runCatching { api.detail(id, kind) } }
    }
    var sources by remember(target) { mutableStateOf<ViewSources?>(null) }
    var failed by remember(target) { mutableStateOf(false) }
    LaunchedEffect(target) {
        val io = Dispatchers.IO
        var current = runCatching { withContext(io) { api.sourcesStart(target.searchTitle) } }.getOrNull()
        failed = current == null
        sources = current
        // 搜索结束后还要继续取，直到测速也结束（站点顺序随测速结果变）
        while (current != null && (!current.done || current.probing)) {
            delay(POLL_MS)
            val id = current.sessionId
            // 会话过期（服务重启等）就重新开始
            current = runCatching { withContext(io) { api.sources(id) ?: api.sourcesStart(target.searchTitle) } }
                .getOrNull() ?: current
            sources = current
        }
    }

    val d = detail?.getOrNull()
    val headerFocus = remember(target) { FocusRequester() }
    var hasContentFocus by remember(target) { mutableStateOf(false) }
    val isTv = LocalIsTv.current
    LaunchedEffect(target, detail != null) {
        if (isTv && detail != null && !hasContentFocus && scroll.firstVisibleItemIndex == 0) {
            headerFocus.requestFocus()
        }
    }
    // 收藏：用户点过就以点的为准（详情晚到也不覆盖）；请求进行中忽略重复点击，失败退回点之前的状态
    var picked by remember(target) { mutableStateOf<Boolean?>(null) }
    var saving by remember(target) { mutableStateOf(false) }
    val favorite = picked ?: d?.favorite ?: false
    val scope = rememberCoroutineScope()
    val toggleFavorite: () -> Unit = toggle@{
        val id = target.doubanId
        val kind = target.kind
        if (saving || id == null || kind == null) return@toggle
        val before = favorite
        picked = !before
        saving = true
        scope.launch {
            picked = runCatching { withContext(Dispatchers.IO) { api.favorite(id, kind, !before) } }
                .getOrDefault(before)
            saving = false
        }
    }
    // 按站点记选中：轮询中插件源插到前面时，选中的站点和焦点所在的集不跳
    var siteKey by remember(target) { mutableStateOf<String?>(null) }
    var lineIndex by remember(target) { mutableIntStateOf(0) }
    val sites = sources?.sites.orEmpty()
    val site = sites.firstOrNull { it.key == siteKey } ?: sites.firstOrNull()
    val line = site?.lines?.let { it.getOrNull(lineIndex) ?: it.firstOrNull() }
    val startPlay: (ViewSourceSite, Int, Int) -> Unit = { s, l, i ->
        play(
                    PlayRequest(
                        // 继续观看的 key 用卡片片名：详情标题先后不同会把同一部片拆成两条记录
                        title = PlayTitle(
                            title = target.title,
                            cover = d?.coverSource,
                            doubanId = target.doubanId,
                            kind = target.kind,
                        ),
                        episodes = s.lines[l].episodes,
                        index = i,
                        // 其余站点各取第一条线路作备用，播放出错或卡住时依次换过去
                        fallbacks = sites.filter { it.key != s.key }.mapNotNull { other ->
                            other.lines.firstOrNull()?.takeIf { it.episodes.isNotEmpty() }
                                ?.let { FallbackLine(other.siteName, it.episodes) }
                        },
                    ),
                )
    }
    // 详情取到（或确定取不到）之前不让点播放：登记继续观看要用它的封面
    val first = line?.episodes?.firstOrNull()
    val actions = DetailActions(
        playLabel = if ((line?.episodes?.size ?: 0) > 1) "播放 ${first?.name.orEmpty()}".trim() else "播放",
        play = if (site != null && line != null && first != null && detail != null) ({ startPlay(site, site.lines.indexOfFirst { it === line }, 0) }) else null,
        favorite = favorite,
        toggleFavorite = toggleFavorite,
    )
    LazyColumn(
        state = scroll,
        modifier = Modifier.fillMaxSize().background(YbColor.Base)
            .onFocusChanged { if (it.hasFocus) hasContentFocus = true }.focusGroup(),
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S6),
    ) {
        item {
            Column(Modifier.focusRequester(headerFocus).focusGroup()) {
                DetailHeader(d, target.title, target.poster, target.backdrop, client, actions) {
                    if (isTv) scroll.requestScrollToItem(0)
                }
            }
        }
        item {
            Sources(sources, failed, playable = detail != null, site, line, { siteKey = it.key; lineIndex = 0 }, { lineIndex = it }, startPlay)
        }
        if (d != null) {
            item { CastRow(d, client) }
            item { StillsRow(d, client) }
        }
    }
}

@Composable
private fun Sources(
    sources: ViewSources?,
    failed: Boolean,
    playable: Boolean,
    site: ViewSourceSite?,
    line: ViewLine?,
    pickSite: (ViewSourceSite) -> Unit,
    pickLine: (Int) -> Unit,
    play: (site: ViewSourceSite, line: Int, index: Int) -> Unit,
) {
    val sites = sources?.sites.orEmpty()
    Column(Modifier.padding(horizontal = gutter()), verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
        RowTitle("播放源")
        val status = when {
            failed -> "选源失败，稍后再试"
            sources == null -> "正在找源…"
            !sources.done -> "正在找源… 已找到 ${sites.size} 个站点"
            sites.isEmpty() -> "没有找到可播放的源"
            sources.probing -> "共 ${sites.size} 个站点 · 测速中…"
            else -> "共 ${sites.size} 个站点 · 测速完成，按速度排序"
        }
        Text(status, color = Muted, fontSize = YbText.Sm, modifier = if (site == null || line == null) Modifier.tvReadingFocus() else Modifier)
        if (site == null || line == null) return@Column
        // 测速中站点按速度重排：列表保持在最前面（LazyRow 默认锚在原来第一个可见的站点上，重排后会滑到后面去）
        val siteList = rememberLazyListState()
        LaunchedEffect(sites.firstOrNull()?.key, sources?.probing) { siteList.scrollToItem(0) }
        LazyRow(state = siteList, horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            items(sites, key = { it.key }) { s -> SourceCard(s, selected = s.key == site.key) { pickSite(s) } }
        }
        if (site.lines.size > 1) {
            Text("线路", color = YbColor.TextTertiary, fontSize = YbText.Xs)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(site.lines) { i, l -> Pill(l.label, selected = l === line) { pickLine(i) } }
            }
        }
        val lineAt = site.lines.indexOfFirst { it === line }
        Text("播放列表", color = YbColor.TextTertiary, fontSize = YbText.Xs)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(line.episodes) { i, ep ->
                Pill(ep.name.ifEmpty { "第 ${i + 1} 集" }) { if (playable) play(site, lineAt, i) }
            }
        }
    }
}
