package com.yingbox.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.engine.playbackDiagnosticReport

/**
 * 手机顶栏「信息」浮层：片源格式一行（与电视面板同一份说法），下面是播放诊断的查看 / 复制，
 * 展开后原地列出诊断报告。查看与复制是原地操作，浮层不关（复制后要能马上看到结果不是复制本身）。
 */
@Composable
internal fun PhoneInfoPopup(state: PlayerState, onClose: () -> Unit) {
    val context = LocalContext.current
    // 与电视面板一致：打开时重探一次能力，诊断里的 HDR / 解码器判断才跟得上当前显示与音频路由
    LaunchedEffect(state, context) { state.refreshCapabilities(context) }
    PhoneTopPopup(onClose, maxWidth = 340.dp) {
        val info = sourceFormatLine(state.stats.snapshot)
        if (info.isNotEmpty()) {
            Text(info, color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.padding(YbSpace.S2))
        }
        PhonePopupItem(if (state.showStats) "收起诊断" else "查看诊断", state.showStats) { state.showStats = !state.showStats }
        PhonePopupItem("复制播放诊断", selected = false) { copyPlaybackDiagnostics(context, state) }
        if (state.showStats) {
            val report = playbackDiagnosticReport(state.stats.snapshot, state.capabilities, state.videoPlan)
            Column(Modifier.fillMaxWidth()) {
                for (line in report.lineSequence().filter { it.isNotBlank() }) {
                    Text(line, color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.fillMaxWidth().padding(YbSpace.S1))
                }
            }
        }
    }
}
