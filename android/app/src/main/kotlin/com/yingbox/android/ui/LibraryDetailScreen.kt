package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.library.LibraryApi
import com.yingbox.android.library.LibraryCard
import com.yingbox.android.library.LibraryEpisode
import com.yingbox.android.library.LibraryItem
import com.yingbox.android.library.LibraryProgress
import com.yingbox.android.library.LibraryType
import com.yingbox.android.library.ProgressWrites
import com.yingbox.android.library.versionLabel
import com.yingbox.android.server.ServerClient
import com.yingbox.android.server.ServerStatusException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 位置在开头这么多秒以内不算看过 */
private const val RESUME_MIN_S = 5.0

/** 详情加载结果 */
private sealed interface DetailState {
    data object Loading : DetailState

    data class Failed(val message: String) : DetailState

    data class Ready(val item: LibraryItem, val progress: Map<Long, LibraryProgress>) : DetailState
}

/** 「S1E3」 */
private fun LibraryEpisode.code(): String = "S$season" + "E$episode"

/** 一集的播放队列项；没有视频文件的集为 null */
private fun LibraryEpisode.entry() =
    versions.firstOrNull()?.let { version ->
        version.fileIds.firstOrNull()?.let { LibraryPlayEntry(itemId, it, "${code()} $title", version.videoProbes[it]) }
    }

/** 这条进度算不算「看到一半」：能接着播 */
private fun LibraryProgress?.inProgress(): Boolean = this != null && !watched && position > RESUME_MIN_S

/** 加载失败的文案：401 是令牌不对，别的给原因 */
internal fun libraryErrorText(e: Exception): String =
    if (e is ServerStatusException && e.status == 401) "令牌不对或 NAS 需要令牌，到设置里检查" else e.message ?: "连不上 NAS"

/**
 * NAS 片库的条目详情（ADR-0040）：电影选版本后播放；剧集选季、点某一集从那一集开始连播。
 * 有进度时「继续播放」从上次的位置接着播。
 */
@Composable
fun LibraryDetailScreen(nas: ServerClient, card: LibraryCard, play: (LibraryPlayRequest) -> Unit) {
    val api = remember(nas) { LibraryApi(nas) }
    val loaded by produceState<DetailState>(DetailState.Loading, nas, card.id) {
        // 刚从播放器退出时最后一次进度还在发，等它落地再读
        ProgressWrites.settle()
        value = withContext(Dispatchers.IO) {
            try {
                val item = api.item(card.id) ?: return@withContext DetailState.Failed("条目已不在片库里")
                val progress = runCatching { api.progress(listOf(card.id)) }.getOrDefault(emptyList())
                DetailState.Ready(item, progress.associateBy { it.itemId })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                DetailState.Failed(libraryErrorText(e))
            }
        }
    }
    when (val state = loaded) {
        DetailState.Loading -> Message("加载中…")
        is DetailState.Failed -> Message(state.message)
        is DetailState.Ready -> DetailBody(nas, state.item, state.progress, play)
    }
}

@Composable
private fun DetailBody(nas: ServerClient, item: LibraryItem, progress: Map<Long, LibraryProgress>, play: (LibraryPlayRequest) -> Unit) {
    val card = item.card
    val isMovie = card.type == LibraryType.Movie
    val episodes = item.episodes.filter { it.entry() != null }
    // 默认入口不从第 0 季（特别篇）开始，除非整部剧只有特别篇
    val regular = episodes.filter { it.season > 0 }.ifEmpty { episodes }

    /** 剧集「继续播放」的那一集：有进度没看完的优先，否则第一个没看完的，都看完了从头 */
    val resumeEpisode = regular.firstOrNull { progress[it.itemId].inProgress() }
        ?: regular.firstOrNull { progress[it.itemId]?.watched != true }
        ?: regular.firstOrNull()
    val seasons = episodes.map { it.season }.distinct()
    var season by remember { mutableStateOf(resumeEpisode?.season ?: seasons.firstOrNull()) }
    var versionIndex by remember { mutableStateOf(0) }

    fun playEpisode(from: LibraryEpisode) {
        val entries = episodes.mapNotNull { it.entry() }
        val index = entries.indexOfFirst { it.itemId == from.itemId }
        if (index >= 0) play(LibraryPlayRequest(entries, index))
    }

    fun playMovie() {
        val version = item.versions.getOrNull(versionIndex) ?: return
        val fileId = version.fileIds.firstOrNull() ?: return
        play(LibraryPlayRequest(listOf(LibraryPlayEntry(card.id, fileId, card.title, version.videoProbes[fileId])), 0))
    }

    val canPlay = if (isMovie) item.versions.isNotEmpty() else resumeEpisode != null
    val resumed = if (isMovie) progress[card.id].inProgress() else resumeEpisode?.let { progress[it.itemId].inProgress() } == true
    val playLabel = when {
        !isMovie && resumeEpisode != null -> (if (resumed) "继续播放 " else "播放 ") + resumeEpisode.code()
        resumed -> "继续播放"
        else -> "播放"
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(start = gutter(), end = gutter(), top = belowBackButton(), bottom = YbSpace.S9),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S5),
    ) {
        card.backdrop?.let { backdrop ->
            item { RemoteImage(backdrop, nas, Modifier.fillMaxWidth().height(200.dp).clip(YbRadius.Card)) }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                PageTitle(card.title)
                val meta = listOfNotNull(
                    card.year?.toString(),
                    item.runtimeMin?.let { "$it 分钟" },
                    item.genres.takeIf { it.isNotEmpty() }?.joinToString(" / "),
                ).joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, color = Muted, fontSize = YbText.Sm)
                RatingBadge(card.rating?.toString().orEmpty(), source = card.ratingSource)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
                if (canPlay) {
                    PrimaryButton(playLabel) { if (isMovie) playMovie() else resumeEpisode?.let(::playEpisode) }
                } else {
                    Text("没有可播放的视频文件", color = Muted, fontSize = YbText.Sm)
                }
            }
        }
        if (isMovie && item.versions.size > 1) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                    Text("版本", color = YbColor.TextSecondary, fontSize = YbText.Sm, fontWeight = FontWeight.Medium)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                        items(item.versions.size) { i ->
                            Pill(versionLabel(item.versions[i]), selected = i == versionIndex) { versionIndex = i }
                        }
                    }
                }
            }
        } else if (isMovie) {
            item.versions.firstOrNull()?.badge?.let { badge -> item { Text(badge, color = YbColor.TextSecondary, fontSize = YbText.Sm) } }
        }
        item.overview?.let { overview -> item { Text(overview, color = YbColor.TextSecondary, fontSize = YbText.Md) } }
        if (!isMovie && episodes.isNotEmpty()) {
            if (seasons.size > 1) {
                item {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                        items(seasons) { s -> Pill(if (s == 0) "特别篇" else "第 $s 季", selected = s == season) { season = s } }
                    }
                }
            }
            items(episodes.filter { it.season == season }, key = { it.itemId }) { e -> EpisodeRow(e, progress[e.itemId]) { playEpisode(e) } }
        }
    }
}

@Composable
private fun EpisodeRow(episode: LibraryEpisode, progress: LibraryProgress?, open: () -> Unit) {
    val state = when {
        progress == null -> ""
        progress.watched -> "已看完"
        progress.inProgress() && progress.duration > 0 -> "看到 ${(progress.position / progress.duration * 100).toInt()}%"
        else -> ""
    }
    Column(
        Modifier
            .fillMaxWidth()
            .background(YbColor.Elevated, YbRadius.Card)
            .tvFocusViewport()
            .focusFrame(shape = YbRadius.Card, onClick = open)
            .padding(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S1),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
            Text("第 ${episode.episode} 集", color = YbColor.TextSecondary, fontSize = YbText.Sm)
            Text(episode.title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            episode.versions.firstOrNull()?.badge?.let { Text(it, color = YbColor.TextSecondary, fontSize = YbText.Xs) }
            if (state.isNotEmpty()) Text(state, color = Muted, fontSize = YbText.Xs)
        }
        episode.overview?.let { Text(it, color = Muted, fontSize = YbText.Xs, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
}
