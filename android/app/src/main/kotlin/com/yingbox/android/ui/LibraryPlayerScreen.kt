package com.yingbox.android.ui

import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.yingbox.android.library.LibraryApi
import com.yingbox.android.library.ProgressWrites
import com.yingbox.android.playback.engine.EXTERNAL_ID_PREFIX
import com.yingbox.android.playback.engine.describeError
import com.yingbox.android.server.ServerClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/**
 * 播放队列里的一项：电影是一个，剧集是各集（按季、集排好）。
 * 分段版本（CD1 / CD2）目前只播第一段，[fileId] 是播放的那个文件。
 */
data class LibraryPlayEntry(val itemId: Long, val fileId: Long, val name: String)

/** 片库开播请求：队列里从第 [index] 个开始 */
data class LibraryPlayRequest(val entries: List<LibraryPlayEntry>, val index: Int)

/** 播放中多久记一次进度 */
private const val REPORT_MS = 5_000L

/** 位置在开头这么多秒以内不算看过，从头播 */
private const val RESUME_MIN_S = 5.0

private const val TAG = "YingboxPlayer"

/** 已经交给播放器的那一项：进度只按它上报，界面上的 index 换了也不串到下一项 */
private data class LoadedEntry(val entry: LibraryPlayEntry)

/**
 * NAS 片库播放（ADR-0040）：直放 `/media/files/<fileId>`，续播位置和进度都在 NAS 的片库里，
 * 视频旁的外挂字幕作为外挂字幕轨（id 以 `ext:` 开头）挂上；播完按设置自动下一个。
 */
@OptIn(UnstableApi::class)
@Composable
fun LibraryPlayerScreen(nas: ServerClient, request: LibraryPlayRequest, autoNext: Boolean, exit: () -> Unit) {
    val autoNextNow by rememberUpdatedState(autoNext)
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val api = remember(nas) { LibraryApi(nas) }
    // 进度按顺序发：播完的「ended」必须先于下一项的进度到服务端
    val reporter = remember { Executors.newSingleThreadExecutor() }
    var index by remember { mutableIntStateOf(request.index) }
    var loaded by remember { mutableStateOf<LoadedEntry?>(null) }
    val state = remember { PlayerState(context, nas) }
    val player = state.player

    /** 把当前进度写回 NAS；播完那一刻的非结束上报丢掉（位置已是片尾，会被当成看完） */
    fun report(ended: Boolean = false) {
        val at = loaded?.entry ?: return
        if (!ended && player.playbackState == Player.STATE_ENDED) return
        val duration = player.duration.takeIf { it > 0 }?.div(1000.0) ?: 0.0
        val position = if (ended) duration else player.currentPosition / 1000.0
        ProgressWrites.begin()
        reporter.execute {
            try {
                api.saveProgress(at.itemId, at.fileId, position, duration, ended)
            } catch (e: Exception) {
                Log.w(TAG, "写回进度失败", e)
            } finally {
                ProgressWrites.end()
            }
        }
    }

    LaunchedEffect(index) {
        state.reset()
        loaded = null
        val entry = request.entries[index]
        val prepared = try {
            withContext(Dispatchers.IO) {
                coroutineScope {
                    // 字幕只是锦上添花，和进度一起取（它自己有短超时）
                    val subtitles = async { api.subtitles(entry.fileId) }
                    // 读不到进度不能当成「从头播」：那样一暂停就会把 NAS 上看到一半的进度覆盖成开头
                    val progress = api.progress(listOf(entry.itemId)).firstOrNull { it.itemId == entry.itemId }
                    // 进度记的是另一个版本（文件）时位置对不上，从头播
                    val resumable = progress?.takeIf { !it.watched && it.position > RESUME_MIN_S && (it.fileId == null || it.fileId == entry.fileId) }
                    (resumable?.position ?: 0.0) to subtitles.await()
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "准备播放失败", e)
            state.error = "读不到续播位置或字幕，检查 NAS 连接后重试：${e.message}"
            return@LaunchedEffect
        }
        val (startAt, subtitles) = prepared
        val item = MediaItem.Builder()
            .setUri(api.fileUrl(entry.fileId))
            .setSubtitleConfigurations(
                subtitles.mapIndexed { n, subtitle ->
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(api.subtitleUrl(subtitle)))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLabel(subtitle.name)
                        .setId("$EXTERNAL_ID_PREFIX$n")
                        // 列表已按默认挂载的优先级排好，第一条默认显示
                        .setSelectionFlags(if (n == 0) C.SELECTION_FLAG_DEFAULT else 0)
                        .build()
                },
            )
            .build()
        player.setMediaItem(item, (startAt * 1000).toLong())
        player.prepare()
        player.playWhenReady = true
        loaded = LoadedEntry(entry)
    }

    LaunchedEffect(loaded) {
        while (loaded != null) {
            delay(REPORT_MS)
            if (player.isPlaying) report()
        }
    }

    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState != Player.STATE_ENDED) return
                report(ended = true)
                loaded = null
                if (autoNextNow && index + 1 < request.entries.size) {
                    // 下一项要先取进度，这段时间里别让遥控器的确定键重播上一项
                    player.stop()
                    index++
                } else {
                    exit()
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying) report()
            }

            override fun onPlayerError(e: PlaybackException) {
                Log.w(TAG, "播放出错", e)
                state.error = describeError(e.errorCode, e.errorCodeName)
            }
        }
        // 退到后台（按 Home 键）就暂停，暂停时会写回一次进度
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        player.addListener(listener)
        lifecycle.addObserver(observer)
        onDispose {
            report()
            lifecycle.removeObserver(observer)
            player.removeListener(listener)
            player.release()
            reporter.shutdown()
        }
    }

    // 手动换集：先把当前这一项的进度记下
    fun goTo(next: Int) {
        report()
        loaded = null
        player.stop()
        index = next
    }
    PlayerHost(
        state,
        request.entries[index].name,
        onPrevious = if (index > 0) ({ goTo(index - 1) }) else null,
        onNext = if (index + 1 < request.entries.size) ({ goTo(index + 1) }) else null,
        onBack = exit,
    )
}
