package com.yingbox.android.ui

import android.util.Log
import androidx.annotation.OptIn
import androidx.compose.foundation.background
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

/** 开播请求：哪部片、整条线路的剧集、从第几集开始 */
data class PlayRequest(
    val title: PlayTitle,
    val episodes: List<ViewEpisode>,
    val index: Int,
)

/** 播放中多久记一次进度（与桌面相近；暂停、退出、播完时另记） */
private const val REPORT_MS = 5_000L
private const val TAG = "YingboxPlayer"

/** 已经交给播放器的那一集：进度只按它上报，界面上的 index 换了也不串到下一集 */
private data class Loaded(val continueId: String, val index: Int)

/**
 * 播放器：每集先登记继续观看（playback.continueStart），再用 view.resume 取续播位置，
 * view.resolve 拿到本服务的播放代理地址交给 ExoPlayer；播完自动下一集。
 */
@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(client: ServerClient, request: PlayRequest, exit: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val api = remember(client) { ViewApi(client) }
    val playback = remember(client) { PlaybackApi(client) }
    // 进度按顺序发：播完的「ended」必须先于下一集的登记到服务端
    val reporter = remember { Executors.newSingleThreadExecutor() }
    var index by remember { mutableIntStateOf(request.index) }
    var loaded by remember { mutableStateOf<Loaded?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val player = remember {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            // 代理要先取上游（DNS、SSRF 校验、上游响应），默认 8 秒对慢源太短
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(mapOf("Authorization" to client.authorization))
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
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
        val name = request.episodes[at.index].name
        reporter.execute {
            runCatching { playback.continueProgress(at.continueId, at.index, name, position, duration, ended) }
                .onFailure { Log.w(TAG, "记进度失败", it) }
        }
    }

    LaunchedEffect(index) {
        error = null
        loaded = null
        val at = index
        val prepared = try {
            withContext(Dispatchers.IO) {
                val id = playback.continueStart(request.title, request.episodes, at)
                val startAt = api.resume(id)?.startAt ?: 0.0
                Triple(id, startAt, api.resolve(request.episodes[at]))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "准备播放失败", e)
            error = "准备播放失败：${e.message}"
            return@LaunchedEffect
        }
        val (id, startAt, playable) = prepared
        if (playable.url.isEmpty()) {
            error = "解析不到播放地址，换个源试试"
            return@LaunchedEffect
        }
        val item = MediaItem.Builder().setUri(client.url(playable.url))
        if (playable.hls) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        player.setMediaItem(item.build(), (startAt * 1000).toLong())
        player.prepare()
        player.playWhenReady = true
        loaded = Loaded(id, at)
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
                if (state != Player.STATE_ENDED) return
                report(ended = true)
                loaded = null
                if (index + 1 < request.episodes.size) index++ else exit()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying) report()
            }

            override fun onPlayerError(e: PlaybackException) {
                Log.w(TAG, "播放出错", e)
                error = "播放出错：${e.errorCodeName}，换个源试试"
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

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = player
                    keepScreenOn = true
                    isFocusable = true
                    // 挂到窗口之后再要焦点，遥控器的方向键、确定键才落到播放器上
                    post { requestFocus() }
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        error?.let {
            Text(
                it,
                color = Color.White,
                fontSize = 16.sp,
                modifier = Modifier.align(Alignment.Center).background(Color(0xCC000000), CardShape).padding(16.dp),
            )
        }
    }
}
