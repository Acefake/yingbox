package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.playback.PlayTitle
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.DoubanKind
import com.yingbox.android.view.SourceKind
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewDetail
import com.yingbox.android.view.ViewSourceSite
import com.yingbox.android.view.ViewSources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** 打开详情需要的身份（来自首页的豆瓣卡） */
data class DetailTarget(
    val doubanId: String,
    val kind: DoubanKind,
    val title: String,
    /** 搜源用的片名（TMDB 找到时是中文名） */
    val searchTitle: String,
    /** 详情还没取到时先显示的海报 */
    val poster: String,
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
fun DetailScreen(client: ServerClient, target: DetailTarget, play: (PlayRequest) -> Unit) {
    val api = remember(client) { ViewApi(client) }
    // 详情取到（或确定取不到）之前不让点集：登记继续观看要用它的封面
    val detail by produceState<Result<ViewDetail?>?>(null, target) {
        value = withContext(Dispatchers.IO) { runCatching { api.detail(target.doubanId, target.kind) } }
    }
    var sources by remember(target) { mutableStateOf<ViewSources?>(null) }
    var failed by remember(target) { mutableStateOf(false) }
    LaunchedEffect(target) {
        val io = Dispatchers.IO
        var current = runCatching { withContext(io) { api.sourcesStart(target.searchTitle) } }.getOrNull()
        failed = current == null
        sources = current
        while (current != null && !current.done) {
            delay(POLL_MS)
            val id = current.sessionId
            // 会话过期（服务重启等）就重新开始
            current = runCatching { withContext(io) { api.sources(id) ?: api.sourcesStart(target.searchTitle) } }
                .getOrNull() ?: current
            sources = current
        }
    }

    val d = detail?.getOrNull()
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item { Header(d, target, client) }
        item {
            Sources(sources, failed, playable = detail != null) { site, line, index ->
                play(
                    PlayRequest(
                        // 继续观看的 key 用卡片片名：详情标题先后不同会把同一部片拆成两条记录
                        title = PlayTitle(
                            title = target.title,
                            cover = d?.coverSource,
                            doubanId = target.doubanId,
                            kind = target.kind,
                        ),
                        episodes = site.lines[line].episodes,
                        index = index,
                    ),
                )
            }
        }
    }
}

@Composable
private fun Header(detail: ViewDetail?, target: DetailTarget, client: ServerClient) {
    Box(Modifier.fillMaxWidth().height(400.dp)) {
        RemoteImage(detail?.backdrop ?: target.poster, client, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Color(0xB3000000)))
        Column(
            Modifier.align(Alignment.BottomStart).padding(horizontal = 48.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(detail?.title ?: target.title, color = Color.White, fontSize = 32.sp)
            if (detail != null) {
                val meta = listOf(
                    detail.year,
                    detail.genres.joinToString(" / "),
                    detail.countries.joinToString(" / "),
                    detail.duration,
                    detail.rating,
                ).filter { it.isNotEmpty() }.joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, color = Subtle, fontSize = 14.sp)
                if (detail.overview.isNotEmpty()) {
                    Text(detail.overview, color = Subtle, fontSize = 14.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
                val people = listOf(
                    detail.directors.take(2).joinToString(" / ").let { if (it.isEmpty()) "" else "导演 $it" },
                    detail.actors.take(4).joinToString(" / ") { it.name }.let { if (it.isEmpty()) "" else "主演 $it" },
                ).filter { it.isNotEmpty() }.joinToString("　")
                if (people.isNotEmpty()) Text(people, color = Muted, fontSize = 13.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Sources(
    sources: ViewSources?,
    failed: Boolean,
    playable: Boolean,
    play: (site: ViewSourceSite, line: Int, index: Int) -> Unit,
) {
    // 按站点记选中：轮询中插件源插到前面时，选中的站点和焦点所在的集不跳
    var siteKey by remember { mutableStateOf<String?>(null) }
    var lineIndex by remember { mutableIntStateOf(0) }
    val sites = sources?.sites.orEmpty()
    val site = sites.firstOrNull { it.key == siteKey } ?: sites.firstOrNull()
    Column(Modifier.padding(horizontal = 48.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RowTitle("选源播放")
        val status = when {
            failed -> "选源失败，稍后再试"
            sources == null -> "正在找源…"
            !sources.done -> "正在找源… 已找到 ${sites.size} 个站点"
            sites.isEmpty() -> "没有找到可播放的源"
            else -> "共 ${sites.size} 个站点"
        }
        Text(status, color = Muted, fontSize = 13.sp)
        if (site == null) return@Column
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(sites, key = { it.key }) { s ->
                Chip(
                    text = s.siteName + if (s.kind == SourceKind.CATSPIDER) " · 插件" else "",
                    selected = s.key == site.key,
                ) {
                    siteKey = s.key
                    lineIndex = 0
                }
            }
        }
        val line = site.lines.getOrNull(lineIndex) ?: site.lines.first()
        if (site.lines.size > 1) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(site.lines) { i, l -> Chip(l.label, selected = l === line) { lineIndex = i } }
            }
        }
        val lineAt = site.lines.indexOf(line)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(line.episodes) { i, ep ->
                Chip(ep.name.ifEmpty { "第 ${i + 1} 集" }) { if (playable) play(site, lineAt, i) }
            }
        }
    }
}

@Composable
private fun Chip(text: String, selected: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.focusFrame(selected = selected, onClick = onClick)
            .background(if (selected) Color.Transparent else Surface, CardShape)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(text, color = Color.White, fontSize = 14.sp, maxLines = 1)
    }
}
