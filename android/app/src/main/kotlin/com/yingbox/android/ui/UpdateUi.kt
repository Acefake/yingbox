package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.focusGroup
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.yingbox.android.update.UpdateController
import com.yingbox.android.update.UpdateState

/** 原生对话框隔离手机触摸和电视焦点；返回键只关闭更新提示。 */
@Composable
fun UpdatePrompt(controller: UpdateController) {
    if (!controller.promptOpen) return
    val state = controller.state
    val first = remember { FocusRequester() }
    Dialog(onDismissRequest = controller::dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        LaunchedEffect(state::class) { first.requestFocus() }
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(YbSpace.S5)
                .background(YbColor.Elevated, YbRadius.Xl).padding(YbSpace.S6),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
        ) {
            Text(
                when (state) {
                    is UpdateState.Downloading -> "正在下载 ${state.update.version}"
                    is UpdateState.Installing -> "安装更新"
                    is UpdateState.Failed -> "更新失败"
                    is UpdateState.Available -> "发现新版本 ${state.update.version}"
                    else -> "应用更新"
                },
                color = YbColor.TextPrimary, fontSize = YbText.Xl, fontWeight = FontWeight.Bold,
            )
            when (state) {
                is UpdateState.Available -> {
                    Text("安装包 %.1f MB".format(state.update.size / (1024 * 1024)), color = YbColor.TextSecondary, fontSize = YbText.Sm)
                    if (state.update.notes.isNotEmpty()) Text(state.update.notes, color = YbColor.TextSecondary, fontSize = YbText.Sm, maxLines = 6, overflow = TextOverflow.Ellipsis)
                }
                is UpdateState.Downloading -> UpdateProgress(state.progress)
                is UpdateState.Installing -> Text(
                    if (state.needsPermission) "在系统设置中允许「影盒」安装应用，返回后点「继续安装」。"
                    else "在系统安装器中确认安装；如已取消，可点「继续安装」重新打开。",
                    color = YbColor.TextSecondary, fontSize = YbText.Sm,
                )
                is UpdateState.Failed -> Text(state.message, color = YbColor.TextSecondary, fontSize = YbText.Sm)
                else -> Unit
            }
            Row(Modifier.focusRequester(first).focusGroup(), horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                when (state) {
                    is UpdateState.Available -> PrimaryButton("更新", onClick = controller::startUpdate)
                    is UpdateState.Installing -> PrimaryButton("继续安装", onClick = controller::startUpdate)
                    is UpdateState.Failed -> if (state.update != null) PrimaryButton("重试", onClick = controller::startUpdate)
                    else -> Unit
                }
                SecondaryButton(if (state is UpdateState.Downloading) "后台下载" else "稍后", onClick = controller::dismiss)
            }
        }
    }
}

@Composable
private fun UpdateProgress(progress: Float) {
    LinearProgressIndicator(progress = { progress.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth(), color = YbColor.TextPrimary, trackColor = YbColor.FillSecondary)
    Text("${(progress * 100).toInt()}%", color = YbColor.TextSecondary, fontSize = YbText.Sm)
}

/** 关于：当前版本、手动检查及下载／安装恢复入口。 */
@Composable
internal fun AboutGroup(controller: UpdateController) {
    val state = controller.state
    SettingsGroup("关于") {
        SettingsRow("版本", modifier = Modifier.tvReadingFocus(YbRadius.Sm)) {
            Text(controller.currentVersion, color = YbColor.TextSecondary, fontSize = YbText.Sm)
        }
        val status = when (state) {
            UpdateState.Idle -> "检查是否有新版本"
            UpdateState.Checking -> "正在检查…"
            UpdateState.UpToDate -> "已是最新版本"
            is UpdateState.Available -> "发现新版本 ${state.update.version}"
            is UpdateState.Downloading -> "正在下载 ${state.update.version}"
            is UpdateState.Installing -> if (state.needsPermission) "请允许影盒安装应用" else "可继续安装已下载的更新"
            is UpdateState.Failed -> state.message
        }
        SettingsRow("更新", status) {
            when (state) {
                is UpdateState.Available -> PrimaryButton("更新", onClick = controller::startUpdate)
                is UpdateState.Installing -> PrimaryButton("继续安装", onClick = controller::startUpdate)
                is UpdateState.Failed -> if (state.update != null) PrimaryButton("重试", onClick = controller::startUpdate) else SecondaryButton("检查更新") { controller.check() }
                is UpdateState.Downloading, UpdateState.Checking -> Unit
                else -> SecondaryButton("检查更新") { controller.check() }
            }
        }
        if (state is UpdateState.Downloading) UpdateProgress(state.progress)
    }
}
