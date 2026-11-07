@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.yingbox.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.media3.common.C
import androidx.media3.ui.AspectRatioFrameLayout
import com.yingbox.android.playback.engine.SPEED_STEPS
import com.yingbox.android.playback.engine.disableTrackType
import com.yingbox.android.playback.engine.options
import com.yingbox.android.playback.engine.select
import com.yingbox.android.playback.engine.speedLabel

/** 一个可选的值：手机浮层和电视面板都用它画 */
data class OptionItem(val label: String, val selected: Boolean, val enabled: Boolean = true, val onSelect: () -> Unit)

/** 一组选项：字幕、音轨、倍速或画面比例 */
data class OptionGroup(val title: String, val items: List<OptionItem>)

private val RESIZE_MODES = listOf(
    "适应" to AspectRatioFrameLayout.RESIZE_MODE_FIT,
    "填充" to AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
    "拉伸" to AspectRatioFrameLayout.RESIZE_MODE_FILL,
)

/**
 * 播放选项（字幕、音轨、倍速、画面比例），手机顶部浮层和电视底部面板共用同一份数据与选择逻辑。
 * 读取 [PlayerState] 的状态，所以选项变化会触发重组。
 */
@Composable
fun rememberOptionGroups(state: PlayerState): List<OptionGroup> {
    val player = state.player
    val text = state.tracks.options(C.TRACK_TYPE_TEXT)
    val audio = state.tracks.options(C.TRACK_TYPE_AUDIO)
    val subtitleOff = C.TRACK_TYPE_TEXT in player.trackSelectionParameters.disabledTrackTypes || text.none { it.selected }
    val none = listOf(OptionItem("无", selected = false, enabled = false, onSelect = {}))
    return remember(player, state.tracks, state.speed, state.resizeMode, subtitleOff) {
        listOf(
            OptionGroup(
                "字幕",
                if (text.isEmpty()) none else listOf(OptionItem("关", subtitleOff) { player.disableTrackType(C.TRACK_TYPE_TEXT) }) +
                    text.map { o -> OptionItem(o.label, o.selected && !subtitleOff) { player.select(o) } },
            ),
            OptionGroup("音轨", if (audio.isEmpty()) none else audio.map { o -> OptionItem(o.label, o.selected) { player.select(o) } }),
            OptionGroup("倍速", SPEED_STEPS.map { s -> OptionItem(speedLabel(s), state.speed == s) { player.setPlaybackSpeed(s) } }),
            OptionGroup("比例", RESIZE_MODES.map { (label, mode) -> OptionItem(label, state.resizeMode == mode) { state.resizeMode = mode } }),
        )
    }
}
