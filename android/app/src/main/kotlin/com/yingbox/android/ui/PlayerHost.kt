package com.yingbox.android.ui

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.yingbox.android.playback.engine.CapabilitiesProbe
import com.yingbox.android.playback.engine.FileVideoProbe
import com.yingbox.android.playback.engine.PlayerFactory
import com.yingbox.android.playback.engine.VideoEnhancer
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.playback.engine.StatsCollector
import com.yingbox.android.playback.engine.VideoPlan
import com.yingbox.android.playback.engine.notice
import com.yingbox.android.playback.engine.planVideo
import com.yingbox.android.playback.engine.selectedVideo
import com.yingbox.android.playback.engine.softwareAudioNotice
import com.yingbox.android.server.ServerClient
import kotlinx.coroutines.delay

/** 遥控器：左右键快退 / 快进，确定 / 回车 / 播放暂停键切换暂停 */
private val REMOTE_KEYS = setOf(Key.DirectionLeft, Key.DirectionRight, Key.DirectionCenter, Key.Enter, Key.MediaPlayPause)

/** 遥控器左右键每次快退 / 快进多久 */
internal const val SEEK_MS = 10_000L

/** 降级、软解这类提示显示多久 */
private const val NOTICE_MS = 6_000L

/** 控制层多久没有操作就自动隐藏（暂停、设置面板打开时不隐藏） */
private const val HIDE_MS = 4_000L

/** 手势的提示显示多久 */
private const val HUD_MS = 900L

private const val TAG = "YingboxPlayer"

/**
 * 播放屏共用的播放器状态：创建播放器（带 [client] 的鉴权头，在线播放和 NAS 播放各传自己的服务），
 * 统计、杜比视界降级提示、错误文案，以及控制层要显示的播放状态（播放中、倍速、画面比例、轨道）。
 * 播放器的释放由各播放屏自己在上报最后一次进度之后做。
 */
@OptIn(UnstableApi::class)
class PlayerState(private val context: Context, client: ServerClient) : Player.Listener {
    private var capabilityDisplayId = android.view.Display.DEFAULT_DISPLAY
    val stats = StatsCollector(context.applicationContext)
    var capabilities by mutableStateOf(CapabilitiesProbe.get(context))
        private set

    /** 只表示能力判断；不作为 HDR 输出已成功的证明。 */
    val videoPlan: VideoPlan
        get() {
            val snapshot = stats.snapshot
            val source = snapshot.sourceVideo.takeIf { snapshot.sourceProbeApplicable }
            return snapshot.video?.let { planVideo(it, capabilities, snapshot.decoderSupport, source) } ?: VideoPlan.Unverified
        }

    /** 显示或音频路由变化时刷新能力，不重建播放器。 */
    fun refreshCapabilities(context: Context, displayId: Int = capabilityDisplayId) {
        capabilityDisplayId = displayId
        capabilities = CapabilitiesProbe.get(context, displayId)
    }
    val player: ExoPlayer = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        // 代理要先取上游（DNS、SSRF 校验、上游响应），默认 8 秒对慢源太短
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(30_000)
        .setDefaultRequestProperties(mapOf("Authorization" to client.authorization))
        .let { PlayerFactory.create(context, it, SEEK_MS) }
        .also {
            it.addAnalyticsListener(stats)
            it.addListener(this)
        }

    private val enhancer = VideoEnhancer(player, context.resources.displayMetrics.heightPixels)
    val enhanceStatus: String get() = enhancer.status
    fun clearEnhanceStatus() { enhancer.dispose() }
    var enhanceLevel by mutableStateOf(DeviceSettings.readEnhanceLevel(context))
        private set

    /** 播放中切换与设备设置共用档位，立即重新评估当前轨道。 */
    fun toggleEnhance() {
        enhanceLevel = if (enhanceLevel == com.yingbox.android.playback.engine.EnhanceLevel.Off)
            com.yingbox.android.playback.engine.EnhanceLevel.Standard else com.yingbox.android.playback.engine.EnhanceLevel.Off
        DeviceSettings(context).updateEnhanceLevel(enhanceLevel)
        enhancer.update(enhanceLevel, tracks.selectedVideo())
    }

    /** 视频降级提示（杜比视界没有对应解码器等） */
    val videoNotice by derivedStateOf { videoPlan.notice() }

    /** 要显示在屏幕中间的错误 */
    var error by mutableStateOf<String?>(null)

    /** 正在播放（不含暂停、缓冲） */
    var isPlaying by mutableStateOf(false)
        private set

    /** 想播放（含缓冲中）：播放暂停按钮看这个，缓冲时 [isPlaying] 是 false 但按钮应该是「暂停」 */
    var playWhenReady by mutableStateOf(true)
        private set

    /** 倍速 */
    var speed by mutableFloatStateOf(1f)
        private set

    /** 画面比例，取值是 [AspectRatioFrameLayout] 的 RESIZE_MODE_* */
    var resizeMode by mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT)

    /** 当前媒体的轨道，设置面板据此列出音轨、字幕 */
    var tracks by mutableStateOf(Tracks.EMPTY)
        private set

    /** 是否在设置面板展开播放诊断 */
    var showStats by mutableStateOf(false)

    /** 换一集或换源之前清掉上一集的统计、提示和错误 */
    fun reset(sourceVideo: FileVideoProbe? = null) {
        enhancer.reset()
        error = null
        stats.reset(sourceVideo)
        tracks = Tracks.EMPTY
    }

    override fun onTracksChanged(tracks: Tracks) {
        this.tracks = tracks
        val videoTrackCount = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }.sumOf { it.length }
        stats.clearMissingTracks(tracks.isTypeSelected(C.TRACK_TYPE_VIDEO), tracks.isTypeSelected(C.TRACK_TYPE_AUDIO), videoTrackCount)
        Log.i(TAG, "轨道视频 ${tracks.selectedVideo()}")
        enhanceLevel = DeviceSettings.readEnhanceLevel(context)
        enhancer.update(enhanceLevel, tracks.selectedVideo())
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        this.isPlaying = isPlaying
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        this.playWhenReady = playWhenReady
    }

    override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
        speed = playbackParameters.speed
    }
}

/**
 * 播放画面：播放器视图、自绘控制层（顶栏、播放控制、进度条、设置面板）、触屏手势、遥控器按键、
 * 顶部提示和居中的错误。[onPrevious]、[onNext] 为空时对应按钮置灰；[onBack] 是控制层顶栏的返回按钮。
 */
@OptIn(UnstableApi::class)
@Composable
fun PlayerHost(state: PlayerState, title: String, onPrevious: (() -> Unit)?, onNext: (() -> Unit)?, onBack: () -> Unit) {
    val player = state.player
    DisposableEffect(state) { onDispose { state.clearEnhanceStatus() } }
    var panelHeight by remember { mutableIntStateOf(0) }
    var viewHeight by remember { mutableIntStateOf(1) }
    ObservePlaybackCapabilities(state)
    // 视频降级与音频软解的提示合成一条，出现后几秒自动消失；
    // 只订阅音频解码器这一项：码率、丢帧每次更新都不该让整个播放页重组
    val audioNotice by remember {
        derivedStateOf { softwareAudioNotice(state.stats.snapshot.audioDecoder, state.stats.snapshot.audioMime) }
    }
    val noticeText = listOfNotNull(state.videoNotice, audioNotice).joinToString("\n").ifEmpty { null }
    var noticeShown by remember { mutableStateOf(false) }
    var hud by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(hud) {
        if (hud != null) {
            delay(HUD_MS)
            hud = null
        }
    }
    LaunchedEffect(noticeText) {
        noticeShown = noticeText != null
        if (noticeText != null) {
            delay(NOTICE_MS)
            noticeShown = false
        }
    }

    var controlsVisible by remember { mutableStateOf(true) }
    var sheetOpen by remember { mutableStateOf(false) }
    // 全屏：横屏 + 隐藏系统栏；右下角的按钮可以切回竖屏（仍然隐藏系统栏）
    var landscape by remember { mutableStateOf(true) }
    PlayerFullscreen(landscape)
    // 正在拖进度条：这期间不自动隐藏（否则手指按住不动 4 秒，控制层消失，松手的跳转就丢了）
    var scrubbing by remember { mutableStateOf(false) }
    // 每次操作都刷新一下，重新计时自动隐藏
    var touched by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    fun poke() {
        controlsVisible = true
        touched = SystemClock.elapsedRealtime()
    }
    LaunchedEffect(controlsVisible, touched, state.isPlaying, sheetOpen, scrubbing) {
        if (controlsVisible && state.isPlaying && !sheetOpen && !scrubbing) {
            delay(HIDE_MS)
            controlsVisible = false
        }
    }
    // 设置面板盖在上面时，返回键先关面板（比外层的返回上一页先收到）
    BackHandler(enabled = sheetOpen) { sheetOpen = false }

    val focus = remember { FocusRequester() }
    // 焦点在根容器自己身上时，遥控器的键是「快退 / 快进 / 暂停 / 开设置」；
    // 按下键会把焦点送进控制层的按钮，这时方向键只用来换按钮、确定键按按钮
    var rootFocused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { focus.requestFocus() }
    // 控制层隐藏、设置面板关闭后，焦点所在的组件已不在了，把焦点还给根容器
    LaunchedEffect(controlsVisible, sheetOpen) {
        if (!sheetOpen && !controlsVisible) runCatching { focus.requestFocus() }
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focus)
            .onFocusChanged { rootFocused = it.isFocused }
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && !sheetOpen) poke()
                false
            }
            .onKeyEvent { event ->
                // 设置面板打开、焦点在控制层的按钮上时，按键交给焦点所在的组件
                if (sheetOpen || !rootFocused) return@onKeyEvent false
                val ours = event.key in REMOTE_KEYS || event.key == Key.DirectionUp
                if (ours && event.type == KeyEventType.KeyDown) {
                    when (event.key) {
                        Key.DirectionLeft -> player.seekBack()
                        Key.DirectionRight -> player.seekForward()
                        Key.DirectionUp -> sheetOpen = true
                        else -> if (player.playWhenReady) player.pause() else player.play()
                    }
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
                    // 控制条由我们自己画；遥控器的键由外层 Compose 容器接，播放器视图自己不抢焦点
                    useController = false
                    isFocusable = false
                }
            },
            update = {
                it.resizeMode = state.resizeMode
                it.subtitleView?.setBottomPaddingFraction(
                    if (controlsVisible && !sheetOpen) ((panelHeight + 12f) / viewHeight).coerceIn(0.08f, 0.8f) else 0.08f,
                )
            },
            modifier = Modifier.fillMaxSize().onSizeChanged { viewHeight = it.height.coerceAtLeast(1) },
        )
        PlayerGestures(state, onTap = { if (controlsVisible) controlsVisible = false else poke() }, onHud = { hud = it })
        // 设置面板打开时控制层让开，免得遥控器的焦点落到被盖住的按钮上
        AnimatedVisibility(controlsVisible && !sheetOpen, enter = fadeIn(), exit = fadeOut()) {
            PlayerControls(
                state,
                title,
                onPrevious,
                onNext,
                openSettings = { sheetOpen = true },
                onActivity = ::poke,
                onScrubbing = { scrubbing = it },
                landscape = landscape,
                onToggleFullscreen = { landscape = !landscape },
                onBack = onBack,
                onPanelHeight = { panelHeight = it },
            )
        }
        // 手势的提示（亮度、音量、快进快退、倍速）盖在控制层上面
        hud?.let {
            Text(
                it,
                color = YbColor.TextPrimary,
                fontSize = YbText.Md,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.align(Alignment.Center).ybGlass(YbRadius.Full, media = true).padding(horizontal = YbSpace.S5, vertical = YbSpace.S3),
            )
        }
        state.error?.let {
            Text(
                it,
                color = YbColor.TextPrimary,
                fontSize = YbText.Md,
                modifier = Modifier.align(Alignment.Center).ybGlass(YbRadius.Lg, media = true).padding(YbSpace.S4),
            )
        }
        if (noticeShown) {
            noticeText?.let {
                Text(
                    it,
                    color = YbColor.TextPrimary,
                    fontSize = YbText.Md,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(YbSpace.S4)
                        // 放在顶栏（标题和徽标）下面一点
                        .padding(top = 72.dp)
                        .ybGlass(YbRadius.Lg, media = true)
                        .padding(YbSpace.S4),
                )
            }
        }
        if (sheetOpen) PlayerSettingsSheet(state) { sheetOpen = false }
    }
}
