package com.yingbox.android.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.media.AudioManager
import android.provider.Settings
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.yingbox.android.playback.engine.formatClock
import com.yingbox.android.playback.engine.gestureDelta
import com.yingbox.android.playback.engine.speedLabel
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** 进度、时间每隔多久刷新一次 */
private const val TICK_MS = 500L

/** 长按时的倍速 */
private const val BOOST_SPEED = 2f


/**
 * 播放控制层：顶栏（标题、信息徽标）、中间的上一集 / 快退 / 播放暂停 / 快进 / 下一集、
 * 底部的进度条与时间、设置按钮。返回按钮在顶栏左边，跟着控制层一起出现、隐藏。
 */
@OptIn(UnstableApi::class)
@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PlayerControls(
    state: PlayerState,
    title: String,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    openSettings: () -> Unit,
    onActivity: () -> Unit,
    onScrubbing: (Boolean) -> Unit,
    landscape: Boolean,
    onToggleFullscreen: () -> Unit,
    onBack: () -> Unit,
    onPanelHeight: (Int) -> Unit = {},
) {
    val player = state.player
    var position by remember { mutableLongStateOf(player.currentPosition) }
    // 时长未知（直播等）时是负数，显示成 --:--，进度条不可拖
    var duration by remember { mutableLongStateOf(player.duration) }
    // 拖动进度条时的位置（0–1）；松手才真正跳转
    var scrub by remember { mutableStateOf<Float?>(null) }
    // 控制层只在可见时组合，轮询随之开关
    LaunchedEffect(player) {
        while (true) {
            position = player.currentPosition
            duration = player.duration
            delay(TICK_MS)
        }
    }
    Box(Modifier.fillMaxSize()) {
        // 顶栏：返回圆钮、标题胶囊（玻璃，跟着控制层一起出现、隐藏）
        val fsrShown = state.enhanceLevel != com.yingbox.android.playback.engine.EnhanceLevel.Off &&
            (state.enhanceComparing || state.enhanceStatus == "FSR")
        Row(
            Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .statusBarsPadding()
                .displayCutoutPadding()
                .padding(start = gutter(), end = gutter(), top = YbSpace.S3, bottom = YbSpace.S3),
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassIconButton(YbIcons.Back, "返回", media = true, onClick = onBack)
        }
        Text(
            title,
            color = YbColor.TextPrimary,
            fontSize = YbText.Md,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.align(Alignment.TopCenter)
                .statusBarsPadding().displayCutoutPadding()
                .fillMaxWidth(0.6f).padding(top = YbSpace.S5),
        )

        // 贴边玻璃控制条：保留触屏进度条和遥控器焦点所需的操作高度
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .onSizeChanged { onPanelHeight(it.height) }
                .fillMaxWidth()
                .ybGlass(RectangleShape, media = true)
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(horizontal = YbSpace.S3),
        ) {
            val sliderColors = SliderDefaults.colors(
                thumbColor = YbColor.TextPrimary,
                activeTrackColor = YbColor.TextPrimary,
                inactiveTrackColor = Color(0x4DFFFFFF),
                disabledThumbColor = YbColor.TextTertiary,
                disabledActiveTrackColor = YbColor.TextTertiary,
                disabledInactiveTrackColor = Color(0x33FFFFFF),
            )
            val shown = scrub ?: if (duration > 0) position.toFloat() / duration else 0f
            val now = scrub?.let { (it * duration).toLong() } ?: position
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                Text(formatClock(now), color = YbColor.TextSecondary, fontSize = YbText.Xs, modifier = Modifier.widthIn(min = 44.dp))
                Slider(
                    value = shown.coerceIn(0f, 1f),
                    onValueChange = {
                        scrub = it
                        onScrubbing(true)
                        onActivity()
                    },
                    onValueChangeFinished = {
                        scrub?.let {
                            val target = (it * duration).toLong()
                            player.seekTo(target)
                            // 先把位置落到松手处，不然滑块会先弹回旧位置，等下一次轮询才跳过去
                            position = target
                        }
                        scrub = null
                        onScrubbing(false)
                    },
                    enabled = duration > 0,
                    modifier = Modifier.weight(1f),
                    thumb = { SliderDefaults.Thumb(remember { MutableInteractionSource() }, thumbSize = DpSize(14.dp, 14.dp), colors = sliderColors) },
                    track = { sliderState ->
                        SliderDefaults.Track(
                            sliderState,
                            Modifier.height(4.dp),
                            colors = sliderColors,
                            drawStopIndicator = null,
                            thumbTrackGapSize = 0.dp,
                            trackInsideCornerSize = 2.dp,
                        )
                    },
                    colors = sliderColors,
                )
                Text(
                    if (duration > 0) "-${formatClock((duration - now).coerceAtLeast(0))}" else "--:--",
                    color = YbColor.TextSecondary,
                    fontSize = YbText.Xs,
                    modifier = Modifier.widthIn(min = 44.dp),
                )
            }
            val compact = LocalConfiguration.current.screenWidthDp < 600
            val options: @Composable () -> Unit = {
                    if (fsrShown) CompareButton(state, onActivity, onScrubbing)
                    TransportButton(PlayerIcons.Enhance, if (state.enhanceLevel == com.yingbox.android.playback.engine.EnhanceLevel.Off) "开启画质增强" else "关闭画质增强", size = 40.dp) { state.toggleEnhance(); onActivity() }
                    TransportButton(YbIcons.Settings, "播放设置", size = 40.dp) { openSettings() }
                    TransportButton(
                        if (landscape) PlayerIcons.FullscreenExit else PlayerIcons.Fullscreen,
                        if (landscape) "退出全屏" else "全屏",
                        size = 40.dp,
                    ) {
                        onToggleFullscreen()
                        onActivity()
                    }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(if (compact) Modifier.width(40.dp) else Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    TransportButton(PlayerIcons.SkipPrevious, "上一集", enabled = onPrevious != null, size = 40.dp) { onPrevious?.invoke() }
                    if (!compact) TransportButton(PlayerIcons.SkipNext, "下一集", enabled = onNext != null, size = 40.dp) { onNext?.invoke() }
                    if (state.speed != 1f) {
                        Text(speedLabel(state.speed), color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.padding(start = YbSpace.S2))
                    }
                }
                Row(if (compact) Modifier.weight(1f) else Modifier.width(168.dp), horizontalArrangement = Arrangement.spacedBy(YbSpace.S1, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                    TransportButton(PlayerIcons.Replay10, "快退 10 秒") { player.seekBack(); onActivity() }
                    // 看「想播放」而不是「正在播放」：缓冲时前者是真，按钮应是「暂停」，点了要真的暂停
                    TransportButton(
                        if (state.playWhenReady) PlayerIcons.Pause else YbIcons.Play,
                        if (state.playWhenReady) "暂停" else "播放",
                        size = 44.dp,
                    ) {
                        if (state.playWhenReady) player.pause() else player.play()
                        onActivity()
                    }
                    TransportButton(PlayerIcons.Forward10, "快进 10 秒") { player.seekForward(); onActivity() }
                }
                if (!compact) Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    options()
                }
                if (compact) Spacer(Modifier.width(40.dp))
            }
            if (compact) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TransportButton(PlayerIcons.SkipNext, "下一集", enabled = onNext != null, size = 40.dp) { onNext?.invoke() }
                Spacer(Modifier.weight(1f))
                options()
            }
        }
    }
}

/** 控制层上的圆形图标按钮；[label] 是叠在图标中间的小字（快进快退的「10」），[big] 是中间的播放暂停 */
@Composable
private fun TransportButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    enabled: Boolean = true,
    big: Boolean = false,
    label: String? = null,
    size: androidx.compose.ui.unit.Dp = if (big) 56.dp else 44.dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.35f)
            .then(if (big) Modifier.background(Color.White, CircleShape) else Modifier)
            .focusFrame(shape = CircleShape, onClick = { if (enabled) onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = if (big) Color.Black else YbColor.TextPrimary, modifier = Modifier.size(if (big) 30.dp else 26.dp))
        if (label != null) Text(label, color = YbColor.TextPrimary, fontSize = YbText.Xs2, fontWeight = FontWeight.Bold)
    }
}

internal fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/**
 * 触屏手势：单击显示 / 隐藏控制层，双击左 / 右半屏快退 / 快进，长按两倍速（松手恢复），
 * 左半屏上下滑调亮度、右半屏上下滑调音量。调节结果交给 [onHud] 显示（画在控制层上面）。
 */
@Composable
internal fun PlayerGestures(state: PlayerState, onTap: () -> Unit, onHud: (String) -> Unit) {
    val player = state.player
    val context = LocalContext.current
    val window = remember { context.activity()?.window }
    val audio = remember { context.getSystemService(AudioManager::class.java) }
    // 窗口亮度是 -1（跟随系统）时取系统当前亮度，免得第一次滑动就跳到别的值
    val systemBrightness = remember {
        runCatching { Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrDefault(0.5f)
    }
    var brightness by remember {
        mutableFloatStateOf(window?.attributes?.screenBrightness?.takeIf { it >= 0 } ?: systemBrightness)
    }
    var brightnessChanged by remember { mutableStateOf(false) }
    fun currentVolume(): Float =
        audio?.let { it.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / it.getStreamMaxVolume(AudioManager.STREAM_MUSIC) } ?: 0.5f
    var volume by remember { mutableFloatStateOf(currentVolume()) }
    // 退出播放时把亮度还给系统（只在这里调过亮度时）
    DisposableEffect(window) {
        onDispose {
            if (brightnessChanged) window?.let { it.attributes = it.attributes.apply { screenBrightness = -1f } }
        }
    }
    var boostedFrom by remember { mutableStateOf<Float?>(null) }
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { offset ->
                        if (offset.x < size.width / 2) {
                            player.seekBack()
                            onHud("-10 秒")
                        } else {
                            player.seekForward()
                            onHud("+10 秒")
                        }
                    },
                    onLongPress = {
                        boostedFrom = state.speed
                        player.setPlaybackSpeed(BOOST_SPEED)
                        onHud(speedLabel(BOOST_SPEED))
                    },
                    onPress = {
                        tryAwaitRelease()
                        boostedFrom?.let { player.setPlaybackSpeed(it) }
                        boostedFrom = null
                    },
                )
            }
            .pointerInput(Unit) {
                var fromLeft = true
                detectVerticalDragGestures(
                    onDragStart = {
                        fromLeft = it.x < size.width / 2
                        // 用实体音量键调过之后，从当前音量开始滑
                        volume = currentVolume()
                    },
                    onVerticalDrag = { change, dy ->
                        change.consume()
                        val delta = gestureDelta(dy, size.height.toFloat())
                        if (fromLeft) {
                            brightness = (brightness + delta).coerceIn(0.02f, 1f)
                            window?.let { it.attributes = it.attributes.apply { screenBrightness = brightness } }
                            brightnessChanged = true
                            onHud("亮度 ${(brightness * 100).roundToInt()}%")
                        } else if (audio != null) {
                            volume = (volume + delta).coerceIn(0f, 1f)
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, (volume * audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).roundToInt(), 0)
                            onHud("音量 ${(volume * 100).roundToInt()}%")
                        }
                    },
                )
            },
    )
}
