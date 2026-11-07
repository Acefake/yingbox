@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.engine.EnhanceLevel
import com.yingbox.android.playback.engine.formatClock
import kotlinx.coroutines.delay

/** 进度、时间每隔多久刷新一次 */
private const val TICK_MS = 500L

/** 顶栏「信息」：Material Symbols 的 info（Apache 2.0），PlayerIcons 只放播放语义的图标 */
private val InfoIcon: ImageVector by lazy {
    ImageVector.Builder("Info", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            PathParser().parsePathString(
                "M11,7h2v2h-2zM11,11h2v6h-2zM12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2z" +
                    "M12,20c-4.41,0 -8,-3.59 -8,-8s3.59,-8 8,-8 8,3.59 8,8 -3.59,8 -8,8z",
            ).toNodes(),
            fill = SolidColor(Color.Black),
        )
        .build()
}

/**
 * 手机播放控制层（Infuse 式）：顶栏是返回钮、两行标题和右侧的字幕 / 音轨 / 倍速 / 比例 / 画质增强 / 信息图标，
 * 选项点开 [PhoneOptionsPopup]，信息点开 [PhoneInfoPopup]；中间是快退 / 播放暂停 / 快进三个大钮；
 * 底部是进度条与上一集 / 下一集。全屏切换在顶栏最右：横竖屏都保留整套控件，不靠"横屏才有"。
 */
@Composable
internal fun PhoneOverlay(
    state: PlayerState,
    title: String,
    subtitle: String?,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    scrubber: Scrubber,
    landscape: Boolean,
    onToggleFullscreen: () -> Unit,
    onActivity: () -> Unit,
    onScrubbing: (Boolean) -> Unit,
    onPopupOpen: (Boolean) -> Unit,
    onPanelHeight: (Int) -> Unit,
    onBack: () -> Unit,
) {
    val player = state.player
    val groups = rememberOptionGroups(state)
    var openGroup by remember { mutableStateOf<OptionGroup?>(null) }
    var infoOpen by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(player.currentPosition) }
    // 时长未知（直播等）时是负数，进度条不可拖
    var duration by remember { mutableLongStateOf(player.duration) }
    // 拖动结束（target 回到 null）时重启轮询，位置马上落到松手处，滑块不会先弹回旧位置
    val scrubbing by remember(scrubber) { derivedStateOf { scrubber.target != null } }
    LaunchedEffect(player, scrubbing) {
        while (true) {
            position = player.currentPosition
            duration = player.duration
            delay(TICK_MS)
        }
    }
    // 浮层开着时控制层不自动隐藏（否则控制层消失，浮层跟着被销毁）；
    // 用单独的信号，不借「拖动中」，免得首次组合 / 销毁时把正在进行的拖动状态清掉
    val popupOpen = openGroup != null || infoOpen
    DisposableEffect(popupOpen) {
        onPopupOpen(popupOpen)
        onDispose { onPopupOpen(false) }
    }
    // 画质增强的对比：只在增强真的生效（或正在对比）时才给按钮，否则按了看不出区别
    val fsrShown = state.enhanceLevel != EnhanceLevel.Off && (state.enhanceComparing || state.enhanceStatus == "FSR")
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .statusBarsPadding()
                .displayCutoutPadding()
                .padding(horizontal = gutter(), vertical = YbSpace.S3),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S2),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                GlassIconButton(YbIcons.Back, "返回", media = true, onClick = onBack)
                Column(Modifier.weight(1f).padding(horizontal = YbSpace.S1)) {
                    Text(title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    // 拆不出集名时不占这一行，免得标题和大图标之间空一格
                    if (subtitle != null) {
                        Text(subtitle, color = YbColor.TextSecondary, fontSize = YbText.Sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                // 竖屏时一行放不下全部选项，选项换到下面一行；全屏切换留在标题这一行，始终点得到
                GlassIconButton(
                    if (landscape) PlayerIcons.FullscreenExit else PlayerIcons.Fullscreen,
                    if (landscape) "退出全屏" else "全屏",
                    media = true,
                ) {
                    onToggleFullscreen()
                    onActivity()
                }
            }
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(YbSpace.S2, Alignment.End),
                verticalArrangement = Arrangement.spacedBy(YbSpace.S2),
            ) {
                for (group in groups) {
                    GlassIconButton(iconFor(group.title), group.title, media = true) {
                        openGroup = group
                        onActivity()
                    }
                }
                GlassIconButton(PlayerIcons.Enhance, "画质增强", media = true) {
                    state.toggleEnhance()
                    onActivity()
                }
                GlassIconButton(InfoIcon, "信息与诊断", media = true) {
                    infoOpen = true
                    onActivity()
                }
                // 按住对比原画：按住期间借用「拖动中」同一个信号，控制层不会被自动隐藏
                if (fsrShown) CompareButton(state, onActivity, onScrubbing)
            }
        }
        Row(
            Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(YbSpace.S8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TransportButton(PlayerIcons.Replay10, "快退 10 秒", size = 56.dp) { player.seekBack(); onActivity() }
            // 看「想播放」而不是「正在播放」：缓冲时前者是真，按钮应是「暂停」，点了要真的暂停
            TransportButton(
                if (state.playWhenReady) PlayerIcons.Pause else YbIcons.Play,
                if (state.playWhenReady) "暂停" else "播放",
                big = true,
                size = 72.dp,
            ) {
                if (state.playWhenReady) player.pause() else player.play()
                onActivity()
            }
            TransportButton(PlayerIcons.Forward10, "快进 10 秒", size = 56.dp) { player.seekForward(); onActivity() }
        }
        PhoneBottomBar(Modifier.align(Alignment.BottomCenter).onSizeChanged { onPanelHeight(it.height) }, scrubber, position, duration, onPrevious, onNext, onActivity, onScrubbing)
        openGroup?.let { PhoneOptionsPopup(it) { openGroup = null } }
        if (infoOpen) PhoneInfoPopup(state) { infoOpen = false }
    }
}

private fun iconFor(title: String): ImageVector = when (title) {
    "字幕" -> PlayerIcons.Subtitles
    "音轨" -> PlayerIcons.Audio
    "倍速" -> PlayerIcons.Speed
    else -> PlayerIcons.Fullscreen
}

/** 底部：渐变压暗，一行「上一集 / 已播时间 / 进度条 / 剩余时间 / 下一集」；上一集、下一集为空时不占位 */
@Composable
private fun PhoneBottomBar(
    modifier: Modifier,
    scrubber: Scrubber,
    position: Long,
    duration: Long,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    onActivity: () -> Unit,
    onScrubbing: (Boolean) -> Unit,
) {
    val sliderColors = SliderDefaults.colors(
        thumbColor = YbColor.TextPrimary,
        activeTrackColor = YbColor.TextPrimary,
        inactiveTrackColor = Color(0x4DFFFFFF),
        disabledThumbColor = YbColor.TextTertiary,
        disabledActiveTrackColor = YbColor.TextTertiary,
        disabledInactiveTrackColor = Color(0x33FFFFFF),
    )
    val now = scrubber.target ?: position
    val shown = if (duration > 0) now.toFloat() / duration else 0f
    Column(
        modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xB3000000))))
            .navigationBarsPadding()
            .displayCutoutPadding()
            .padding(horizontal = gutter(), vertical = YbSpace.S2),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
            if (onPrevious != null) TransportButton(PlayerIcons.SkipPrevious, "上一集", size = 40.dp) { onPrevious(); onActivity() }
            Text(formatClock(now), color = YbColor.TextSecondary, fontSize = YbText.Xs, modifier = Modifier.widthIn(min = 44.dp))
            Slider(
                value = shown.coerceIn(0f, 1f),
                onValueChange = {
                    if (scrubber.target == null) scrubber.begin(position)
                    scrubber.dragTo((it * duration).toLong())
                    onScrubbing(true)
                    onActivity()
                },
                onValueChangeFinished = {
                    scrubber.commit()
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
            if (onNext != null) TransportButton(PlayerIcons.SkipNext, "下一集", size = 40.dp) { onNext(); onActivity() }
        }
    }
}
