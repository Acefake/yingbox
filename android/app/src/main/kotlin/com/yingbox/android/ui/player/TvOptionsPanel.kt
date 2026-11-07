package com.yingbox.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.engine.EnhanceLevel
import com.yingbox.android.playback.engine.HdrKind
import com.yingbox.android.playback.engine.StatsSnapshot
import com.yingbox.android.playback.engine.audioCodecName
import com.yingbox.android.playback.engine.playbackDiagnosticReport

/**
 * 电视选项面板（遥控器下键唤出）：底部玻璃面板，列为字幕 / 音轨 / 倍速 / 比例 / 其他（画质增强、诊断）。
 * 列间左右键、列内上下键靠焦点系统；确定键选中后关闭面板，诊断的显示 / 复制是原地操作不关闭。
 * 顶部一行是片源格式信息。
 */
@Composable
internal fun TvOptionsPanel(state: PlayerState, groups: List<OptionGroup>, onClose: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(state, context) { state.refreshCapabilities(context) }
    val enhanceOn = state.enhanceLevel != EnhanceLevel.Off
    val more = OptionGroup(
        "其他",
        listOf(
            OptionItem("画质增强", enhanceOn) { state.toggleEnhance() },
            OptionItem(if (state.showStats) "收起诊断" else "查看诊断", state.showStats) { state.showStats = !state.showStats },
            OptionItem("复制诊断", false) { copyPlaybackDiagnostics(context, state) },
        ),
    )
    val columns = groups + more
    // 打开时焦点落在当前选中的第一项，没有选中项就落在第一个可用项
    val focusTarget = remember {
        val selected = columns.firstNotNullOfOrNull { g -> g.items.indexOfFirst { it.selected && it.enabled }.takeIf { it >= 0 }?.let { columns.indexOf(g) to it } }
        selected ?: columns.firstNotNullOfOrNull { g -> g.items.indexOfFirst { it.enabled }.takeIf { it >= 0 }?.let { columns.indexOf(g) to it } }
    }
    val initialFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { initialFocus.requestFocus() } }
    // 面板最高占屏幕的 70%：诊断报告展开后内容多，面板内可以上下滚动
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.7f).dp
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 1100.dp)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(YbSpace.S6)
                .ybGlass(YbRadius.Card, media = true)
                .heightIn(max = maxHeight)
                .verticalScroll(rememberScrollState())
                .padding(YbSpace.S5),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
        ) {
            val info = sourceFormatLine(state.stats.snapshot)
            if (info.isNotEmpty()) Text(info, color = YbColor.TextSecondary, fontSize = YbText.Sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                columns.forEachIndexed { gi, group ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
                        Text(group.title, color = YbColor.TextSecondary, fontSize = YbText.Sm, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = YbSpace.S3, bottom = YbSpace.S1))
                        group.items.forEachIndexed { ii, item ->
                            PanelItem(
                                item,
                                if (focusTarget == gi to ii) Modifier.focusRequester(initialFocus) else Modifier,
                            ) {
                                item.onSelect()
                                // 「其他」里只有画质增强（第一项）关面板，诊断的显示 / 复制留在原地
                                if (group !== more || ii == 0) onClose()
                            }
                        }
                    }
                }
            }
            if (state.showStats) {
                val report = playbackDiagnosticReport(state.stats.snapshot, state.capabilities, state.videoPlan)
                Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
                    for (line in report.lineSequence().filter { it.isNotBlank() }) {
                        Text(line, color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.fillMaxWidth().tvReadingFocus().padding(YbSpace.S1))
                    }
                }
            }
        }
    }
}

/** 面板里的一项：选中的前面有「✓」；不可用的项变暗且不接收焦点 */
@Composable
private fun PanelItem(item: OptionItem, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .alpha(if (item.enabled) 1f else 0.4f)
            .focusProperties { canFocus = item.enabled }
            .focusFrame(shape = YbRadius.Sm, onClick = { if (item.enabled) onClick() })
            .padding(horizontal = YbSpace.S3, vertical = YbSpace.S2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (item.selected) "✓" else "", color = YbColor.TextPrimary, fontSize = YbText.Md, modifier = Modifier.widthIn(min = 18.dp))
        Text(item.label, color = YbColor.TextPrimary, fontSize = YbText.Md, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * 片源格式信息：分辨率、动态范围、帧率、音频格式，用「 · 」隔开；还没读到的项不显示。
 * 电视选项面板和手机信息浮层共用这一行，两端的说法与顺序保持一致。
 */
internal fun sourceFormatLine(snapshot: StatsSnapshot): String {
    val video = snapshot.video
    return listOfNotNull(
        video?.takeIf { it.width > 0 }?.let { "${it.width}×${it.height}" },
        video?.let {
            when (it.hdr) {
                HdrKind.DolbyVision -> it.dv?.let { dv -> "杜比视界 P${dv.profile}" } ?: "杜比视界"
                HdrKind.Hdr10, HdrKind.Hlg, HdrKind.Sdr -> it.hdr.label
                HdrKind.Unknown -> null
            }
        },
        video?.frameRate?.takeIf { it > 0f }?.let { "${if (it % 1f == 0f) it.toInt().toString() else "%.2f".format(it)} fps" },
        audioCodecName(snapshot.audioMime),
    ).joinToString("  ·  ")
}
