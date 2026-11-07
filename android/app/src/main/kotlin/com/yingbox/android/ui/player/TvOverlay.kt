package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.engine.EnhanceLevel
import com.yingbox.android.playback.engine.formatClock
import kotlinx.coroutines.delay

/** 进度、时间每隔多久刷新一次 */
private const val TICK_MS = 500L

/**
 * 电视播放控制层（Infuse tvOS 式）：左上两行标题；底部渐变区里是进度条、左右时间，
 * 下面一行按钮「上一集 / 快退 / 播放暂停 / 快进 / 下一集 / 选项」。
 * 默认焦点在播放暂停；方向键只在按钮间移动，不需要触摸。[onOpenPanel] 打开 [TvOptionsPanel]。
 */
@Composable
internal fun TvOverlay(
    state: PlayerState,
    title: String,
    subtitle: String?,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    scrubber: Scrubber,
    onActivity: () -> Unit,
    onOpenPanel: () -> Unit,
    onPanelHeight: (Int) -> Unit,
) {
    val player = state.player
    var position by remember { mutableLongStateOf(player.currentPosition) }
    // 时长未知（直播等）时是负数，进度条不可拖
    var duration by remember { mutableLongStateOf(player.duration) }
    // 拖动结束（target 回到 null）时重启轮询，位置马上落到跳转处，进度条不会先弹回旧位置
    val scrubbing by remember(scrubber) { derivedStateOf { scrubber.target != null } }
    LaunchedEffect(player, scrubbing) {
        while (true) {
            position = player.currentPosition
            duration = player.duration
            delay(TICK_MS)
        }
    }
    val playFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { playFocus.requestFocus() } }
    val fsrShown = state.enhanceLevel != EnhanceLevel.Off && (state.enhanceComparing || state.enhanceStatus == "FSR")
    val now = scrubber.target ?: position
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent)))
                .statusBarsPadding()
                .displayCutoutPadding()
                .padding(horizontal = gutter(), vertical = YbSpace.S5),
        ) {
            Text(title, color = YbColor.TextPrimary, fontSize = YbText.Lg, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(subtitle, color = YbColor.TextSecondary, fontSize = YbText.Md, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .onSizeChanged { onPanelHeight(it.height) }
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000))))
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(horizontal = gutter(), vertical = YbSpace.S5),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S3),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                Text(formatClock(now), color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.widthIn(min = 56.dp))
                TvProgressBar(now, duration, scrubber, { player.currentPosition }, onActivity, Modifier.weight(1f))
                Text(
                    if (duration > 0) "-${formatClock((duration - now).coerceAtLeast(0))}" else "--:--",
                    color = YbColor.TextSecondary,
                    fontSize = YbText.Sm,
                    modifier = Modifier.widthIn(min = 56.dp),
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(YbSpace.S6, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                if (onPrevious != null) TransportButton(PlayerIcons.SkipPrevious, "上一集") { onPrevious(); onActivity() }
                TransportButton(PlayerIcons.Replay10, "快退 10 秒") { player.seekBack(); onActivity() }
                // 看「想播放」而不是「正在播放」：缓冲时前者是真，按钮应是「暂停」，点了要真的暂停
                TransportButton(
                    if (state.playWhenReady) PlayerIcons.Pause else YbIcons.Play,
                    if (state.playWhenReady) "暂停" else "播放",
                    modifier = Modifier.focusRequester(playFocus),
                    big = true,
                    size = 64.dp,
                ) {
                    if (state.playWhenReady) player.pause() else player.play()
                    onActivity()
                }
                TransportButton(PlayerIcons.Forward10, "快进 10 秒") { player.seekForward(); onActivity() }
                if (onNext != null) TransportButton(PlayerIcons.SkipNext, "下一集") { onNext(); onActivity() }
                if (fsrShown) CompareButton(state, onActivity, onHold = {})
                TransportButton(YbIcons.Settings, "选项") { onOpenPanel() }
            }
        }
    }
}

/**
 * 电视进度条：自绘一条 6dp 的轨道加圆点，可聚焦。聚焦时左右键拖进度（连发加速，松手提交，
 * 与根容器的隐藏态共用 [Scrubber]）；上下键交给焦点系统在进度条和按钮行之间移动。
 */
@Composable
private fun TvProgressBar(shownMs: Long, durationMs: Long, scrubber: Scrubber, positionMs: () -> Long, onActivity: () -> Unit, modifier: Modifier) {
    val fraction = if (durationMs > 0) (shownMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    Box(
        modifier
            .height(28.dp)
            .onKeyEvent { event ->
                val direction = when (event.key) {
                    Key.DirectionLeft -> -1
                    Key.DirectionRight -> 1
                    else -> return@onKeyEvent false
                }
                when (event.type) {
                    KeyEventType.KeyDown -> {
                        scrubber.remoteStep(event, direction, positionMs())
                        onActivity()
                        true
                    }
                    KeyEventType.KeyUp -> {
                        scrubber.commit()
                        true
                    }
                    else -> false
                }
            }
            .focusFrame(shape = YbRadius.Full),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(6.dp).clip(YbRadius.Full).background(Color(0x4DFFFFFF)))
        Box(Modifier.fillMaxWidth(fraction).height(6.dp).clip(YbRadius.Full).background(Color.White))
        Box(Modifier.fillMaxWidth(fraction), contentAlignment = Alignment.CenterEnd) {
            Box(Modifier.size(14.dp).clip(CircleShape).background(Color.White))
        }
    }
}

/** 隐藏态按住左右键拖进度时，屏幕中央显示的目标时间 */
@Composable
internal fun ScrubTime(targetMs: Long, modifier: Modifier = Modifier) {
    Text(
        formatClock(targetMs),
        color = YbColor.TextPrimary,
        fontSize = YbText.Xl,
        fontWeight = FontWeight.Medium,
        modifier = modifier.ybGlass(YbRadius.Full, media = true).padding(horizontal = YbSpace.S6, vertical = YbSpace.S3),
    )
}
