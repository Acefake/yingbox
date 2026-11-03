package com.yingbox.android.ui

import android.util.Log
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.yingbox.android.playback.PlayTitle
import com.yingbox.android.playback.PlaybackApi
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewEpisode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/** 备用线路：别的站点同一部片的剧集，播放出错或卡住时依次换过去 */
data class FallbackLine(val siteName: String, val episodes: List<ViewEpisode>)

/** 开播请求：哪部片、整条线路的剧集、从第几集开始、备用线路 */
data class PlayRequest(
    val title: PlayTitle,
    val episodes: List<ViewEpisode>,
    val index: Int,
    val fallbacks: List<FallbackLine> = emptyList(),
)

/** 播放中多久记一次进度（与桌面相近；暂停、退出、播完时另记） */
private const val REPORT_MS = 5_000L

/** 遥控器：左右键快退 / 快进，确定 / 回车 / 播放暂停键切换暂停 */
private val REMOTE_KEYS = setOf(Key.DirectionLeft, Key.DirectionRight, Key.DirectionCenter, Key.Enter, Key.MediaPlayPause)

/** 遥控器左右键每次快退 / 快进多久 */
private const val SEEK_MS = 10_000L

/** 缓冲多久算卡住、该换源（桌面默认 5 秒，手机上代理起播更慢，取 12 秒） */
private const val STALL_MS = 12_000L
private const val TAG = "YingboxPlayer"

/** 已经交给播放器的那一集：进度只按它上报，界面上的 index 换了也不串到下一集 */
private data class Loaded(val continueId: String, val index: Int)

/**
 * 播放器：每集先登记继续观看（playback.continueStart），再用 view.resume 取续播位置，
 * view.resolve 拿到本服务的播放代理地址交给 ExoPlayer；播完自动下一集。
 */
@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(client: ServerClient, request: PlayRequest, autoNext: Boolean, autoSwitch: Boolean, exit: () -> Unit) {
    // 监听器只建一次，设置改了要读到最新值
    val autoNextNow by rememberUpdatedState(autoNext)
    val autoSwitchNow by rememberUpdatedState(autoSwitch)
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val api = remember(client) { ViewApi(client) }
    val playback = remember(client) { PlaybackApi(client) }
    // 进度按顺序发：播完的「ended」必须先于下一集的登记到服务端
    val reporter = remember { Executors.newSingleThreadExecutor() }
    var index by remember { mutableIntStateOf(request.index) }
    // 当前播的线路；换源后是备用线路。sourceNo 每换一次加 1，触发重新准备；switchAt 是换源时要接着播的位置
    var lines by remember { mutableStateOf(request.episodes) }
    var sourceNo by remember { mutableIntStateOf(0) }
    var nextFallback by remember { mutableIntStateOf(0) }
    var switchAt by remember { mutableStateOf<Long?>(null) }
    var buffering by remember { mutableStateOf(false) }
    // 换源到新线路真正载入之前：旧媒体的缓冲和报错都不再触发下一次换源
    var switching by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf<Loaded?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var view by remember { mutableStateOf<PlayerView?>(null) }
    val player = remember {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            // 代理要先取上游（DNS、SSRF 校验、上游响应），默认 8 秒对慢源太短
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(mapOf("Authorization" to client.authorization))
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(SEEK_MS)
            .setSeekForwardIncrementMs(SEEK_MS)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
    }

    /** 把当前进度记进继续观看；播完那一刻的非结束上报丢掉（位置已是片尾，会被当成看完） */
    fun report(ended: Boolean = false) {
        val at = loaded ?: return
        if (!ended && player.playbackState == Player.STATE_ENDED) return
        val duration = player.duration.takeIf { it > 0 }?.div(1000.0) ?: 0.0
        val position = if (ended) duration else player.currentPosition / 1000.0
        val name = lines[at.index].name
        reporter.execute {
            runCatching { playback.continueProgress(at.continueId, at.index, name, position, duration, ended) }
                .onFailure { Log.w(TAG, "记进度失败", it) }
        }
    }

    /**
     * 换到下一条备用线路并接着当前位置播；备用线路里按集名找同一集，没有同名的再按序号。
     * 开关关了、正在换、没有可换的返回 false。播放器还没载入这一集时（解析阶段失败）没有位置，续播位置仍按记录取。
     */
    fun switchSource(reason: String): Boolean {
        if (!autoSwitchNow || switching) return false
        val current = lines.getOrNull(index)?.name
        for (candidate in nextFallback until request.fallbacks.size) {
            val line = request.fallbacks[candidate]
            if (line.episodes === lines) continue
            val at = line.episodes.indexOfFirst { it.name == current }.takeIf { it >= 0 }
                ?: index.takeIf { it < line.episodes.size }
                ?: continue
            nextFallback = candidate + 1
            switchAt = if (loaded != null) player.currentPosition else null
            switching = true
            buffering = false
            player.stop()
            player.clearMediaItems()
            lines = line.episodes
            index = at
            sourceNo++
            Toast.makeText(context, "$reason，换到 ${line.siteName}", Toast.LENGTH_SHORT).show()
            return true
        }
        return false
    }

    LaunchedEffect(index, sourceNo) {
        error = null
        loaded = null
        val at = index
        val prepared = try {
            withContext(Dispatchers.IO) {
                val id = playback.continueStart(request.title, lines, at)
                val startAt = switchAt?.div(1000.0) ?: api.resume(id)?.startAt ?: 0.0
                Triple(id, startAt, api.resolve(lines[at]))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "准备播放失败", e)
            switching = false
            if (!switchSource("解析失败")) error = "准备播放失败：${e.message}"
            return@LaunchedEffect
        }
        val (id, startAt, playable) = prepared
        if (playable.url.isEmpty()) {
            switching = false
            if (!switchSource("解析不到播放地址")) error = "解析不到播放地址，换个源试试"
            return@LaunchedEffect
        }
        switchAt = null
        val item = MediaItem.Builder().setUri(client.url(playable.url))
        if (playable.hls) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        player.setMediaItem(item.build(), (startAt * 1000).toLong())
        player.prepare()
        player.playWhenReady = true
        loaded = Loaded(id, at)
        switching = false
    }

    // 缓冲超过 STALL_MS 还没恢复就换源
    LaunchedEffect(buffering, switching, sourceNo, index) {
        if (!buffering || switching) return@LaunchedEffect
        delay(STALL_MS)
        val foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        if (player.playWhenReady && foreground) switchSource("卡顿")
    }

    LaunchedEffect(loaded) {
        while (loaded != null) {
            delay(REPORT_MS)
            if (player.isPlaying) report()
        }
    }

    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING
                if (state != Player.STATE_ENDED) return
                report(ended = true)
                loaded = null
                if (autoNextNow && index + 1 < lines.size) {
                    nextFallback = 0
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
                if (switching) return
                if (!switchSource("播放出错")) error = "播放出错：${e.errorCodeName}，换个源试试"
            }
        }
        // 退到后台（按 Home 键）就暂停，暂停时会记一次进度
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

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focus)
            .onKeyEvent { event ->
                val ours = event.key in REMOTE_KEYS
                if (ours && event.type == KeyEventType.KeyDown) {
                    when (event.key) {
                        Key.DirectionLeft -> player.seekBack()
                        Key.DirectionRight -> player.seekForward()
                        else -> if (player.isPlaying) player.pause() else player.play()
                    }
                    view?.showController()
                }
                ours
            }
            .focusable(),
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = player
                    keepScreenOn = true
                    // 遥控器的键由外层 Compose 容器接（左右快退快进、确定暂停），播放器视图自己不抢焦点
                    isFocusable = false
                    view = this
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        error?.let {
            Text(
                it,
                color = YbColor.TextPrimary,
                fontSize = YbText.Md,
                modifier = Modifier.align(Alignment.Center).ybGlass(YbRadius.Lg, media = true).padding(YbSpace.S4),
            )
        }
    }
}
