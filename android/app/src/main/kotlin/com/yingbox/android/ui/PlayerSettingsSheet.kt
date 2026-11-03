package com.yingbox.android.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import com.yingbox.android.playback.engine.SPEED_STEPS
import com.yingbox.android.playback.engine.disableTrackType
import com.yingbox.android.playback.engine.options
import com.yingbox.android.playback.engine.select
import com.yingbox.android.playback.engine.speedLabel

/** 画面比例：适应（留黑边）、填充（裁掉多出的）、拉伸 */
private val RESIZE_MODES = listOf(
    "适应" to AspectRatioFrameLayout.RESIZE_MODE_FIT,
    "填充" to AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
    "拉伸" to AspectRatioFrameLayout.RESIZE_MODE_FILL,
)

/**
 * 播放设置面板：音轨、字幕、倍速、画面比例、统计信息。点面板外或按返回键关闭。
 * 选项都是可聚焦的胶囊，遥控器方向键能走到。
 */
@OptIn(UnstableApi::class)
@Composable
internal fun BoxScope.PlayerSettingsSheet(state: PlayerState, close: () -> Unit) {
    val player = state.player
    val audio = state.tracks.options(C.TRACK_TYPE_AUDIO)
    val text = state.tracks.options(C.TRACK_TYPE_TEXT)
    val subtitleOff = C.TRACK_TYPE_TEXT in player.trackSelectionParameters.disabledTrackTypes || text.none { it.selected }
    // 面板最高占屏幕的 70%，内容多（很多条音轨字幕）时可以滚动
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.7f).dp
    // 面板打开后把焦点送进去（遥控器），暗层本身不参与焦点
    val panelFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { panelFocus.requestFocus() } }
    // 面板外的暗层：点一下关闭
    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x66000000))
            .focusProperties { canFocus = false }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = close),
    )
    Column(
        Modifier
            .align(Alignment.BottomCenter)
            .widthIn(max = 640.dp)
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(YbSpace.S3)
            .focusRequester(panelFocus)
            .focusGroup()
            .ybGlass(YbRadius.Card, media = true)
            .heightIn(max = maxHeight)
            .verticalScroll(rememberScrollState())
            .padding(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
    ) {
        if (audio.isNotEmpty()) {
            Section("音轨") {
                for (option in audio) Pill(option.label, selected = option.selected, container = YbColor.FillSecondary) { player.select(option) }
            }
        }
        Section("字幕") {
            Pill("关", selected = subtitleOff, container = YbColor.FillSecondary) { player.disableTrackType(C.TRACK_TYPE_TEXT) }
            for (option in text) {
                Pill(option.label, selected = option.selected && !subtitleOff, container = YbColor.FillSecondary) { player.select(option) }
            }
        }
        Section("倍速") {
            for (speed in SPEED_STEPS) {
                Pill(speedLabel(speed), selected = state.speed == speed, container = YbColor.FillSecondary) { player.setPlaybackSpeed(speed) }
            }
        }
        Section("画面") {
            for ((label, mode) in RESIZE_MODES) {
                Pill(label, selected = state.resizeMode == mode, container = YbColor.FillSecondary) { state.resizeMode = mode }
            }
        }
        Section("信息") {
            Pill(if (state.showStats) "统计信息：开" else "统计信息：关", selected = state.showStats, container = YbColor.FillSecondary) {
                state.showStats = !state.showStats
            }
        }
    }
}

/** 一组选项：小标题加一行可横向滚动的胶囊 */
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        Text(title, color = YbColor.TextSecondary, fontSize = YbText.Sm, fontWeight = FontWeight.Medium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) { content() }
    }
}
