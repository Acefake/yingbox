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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.yingbox.android.playback.engine.formatClock
import com.yingbox.android.playback.engine.gestureDelta
import com.yingbox.android.playback.engine.playbackBadges
import com.yingbox.android.playback.engine.speedLabel
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** 进度、时间每隔多久刷新一次 */
private const val TICK_MS = 500L

/** 长按时的倍速 */
private const val BOOST_SPEED = 2f

private val TOP_SCRIM = Brush.verticalGradient(listOf(Color(0xB3000000), Color.Transparent))
private val BOTTOM_SCRIM = Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))

/**
 * 播放控制层：顶栏（标题、信息徽标）、中间的上一集 / 快退 / 播放暂停 / 快进 / 下一集、
 * 底部的进度条与时间、设置按钮。返回按钮在顶栏左边，跟着控制层一起出现、隐藏。
 */
@OptIn(UnstableApi::class)
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
    // 只订阅视频规格和音频格式：码率、丢帧每次更新都不该让控制层（含进度条）重组
    val badges by remember(state) {
        derivedStateOf { playbackBadges(state.stats.snapshot.video, state.stats.snapshot.audioMime) }
    }
    Box(Modifier.fillMaxSize()) {
        // 顶栏：返回按钮、标题、徽标。返回按钮跟着控制层一起出现、一起隐藏
        Row(
            Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .background(TOP_SCRIM)
                .statusBarsPadding()
                .displayCutoutPadding()
                .padding(start = gutter(), end = YbSpace.S4, top = YbSpace.S3, bottom = YbSpace.S6),
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
        ) {
            GlassIconButton(YbIcons.Back, "返回", media = true, onClick = onBack)
            Column(Modifier.weight(1f).padding(top = YbSpace.S1), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                Text(title, color = YbColor.TextPrimary, fontSize = YbText.Xl, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (badges.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                        for (badge in badges) {
                            Text(
                                badge,
                                color = YbColor.TextPrimary,
                                fontSize = YbText.Xs,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.background(YbColor.FillSecondary, YbRadius.Full).padding(horizontal = YbSpace.S3, vertical = YbSpace.S1),
                            )
                        }
                    }
                }
            }
        }

        Row(
            Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S5),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TransportButton(PlayerIcons.SkipPrevious, "上一集", enabled = onPrevious != null) { onPrevious?.invoke() }
            TransportButton(PlayerIcons.Replay10, "快退 10 秒") { player.seekBack(); onActivity() }
            // 看「想播放」而不是「正在播放」：缓冲时前者是真，按钮应是「暂停」，点了要真的暂停
            TransportButton(if (state.playWhenReady) PlayerIcons.Pause else YbIcons.Play, if (state.playWhenReady) "暂停" else "播放", big = true) {
                if (state.playWhenReady) player.pause() else player.play()
                onActivity()
            }
            TransportButton(PlayerIcons.Forward10, "快进 10 秒") { player.seekForward(); onActivity() }
            TransportButton(PlayerIcons.SkipNext, "下一集", enabled = onNext != null) { onNext?.invoke() }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(BOTTOM_SCRIM)
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(horizontal = gutter(), vertical = YbSpace.S3),
        ) {
            val shown = scrub ?: if (duration > 0) position.toFloat() / duration else 0f
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
                colors = SliderDefaults.colors(
                    thumbColor = YbColor.TextPrimary,
                    activeTrackColor = YbColor.TextPrimary,
                    inactiveTrackColor = Color(0x4DFFFFFF),
                    disabledThumbColor = YbColor.TextTertiary,
                    disabledActiveTrackColor = YbColor.TextTertiary,
                    disabledInactiveTrackColor = Color(0x33FFFFFF),
                ),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                val now = scrub?.let { (it * duration).toLong() } ?: position
                Text(
                    "${formatClock(now)} / ${formatClock(duration)}",
                    color = YbColor.TextPrimary,
                    fontSize = YbText.Sm,
                    modifier = Modifier.weight(1f),
                )
                if (state.speed != 1f) {
                    Text(speedLabel(state.speed), color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.padding(end = YbSpace.S3))
                }
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
    size: androidx.compose.ui.unit.Dp = if (big) 64.dp else 48.dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.35f)
            .then(if (big) Modifier.background(Color(0x40FFFFFF), CircleShape) else Modifier)
            .focusFrame(shape = CircleShape, onClick = { if (enabled) onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = YbColor.TextPrimary, modifier = Modifier.size(if (big) 32.dp else 26.dp))
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
