package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.settings.NetworkOptions
import com.yingbox.android.settings.ServerSettingsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 手机与 TV 共用的本机网络设置；后台请求与 APK 下载分别落到服务端和设备存储。 */
@Composable
internal fun NetworkSettingsGroup(api: ServerSettingsApi, device: DeviceSettings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(device.networkOptions) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var address by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    LaunchedEffect(api) {
        runCatching { withContext(Dispatchers.IO) { api.networkOptions() } }
            .onSuccess { draft = it; loaded = true }
            .onFailure { result = "读取配置失败，请重新打开设置：${it.message}" }
    }
    fun perform(save: Boolean) {
        if (busy || !loaded) return
        busy = true
        val value = draft
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                runCatching {
                    if (save) { api.setNetworkOptions(value); "已保存，新的请求使用此配置" }
                    else api.probeNetwork(value)
                }
            }
            busy = false
            outcome.onSuccess {
                if (save) device.updateNetworkOptions(value)
                result = it
            }.onFailure { Toast.makeText(context, "操作失败：${it.message}", Toast.LENGTH_LONG).show() }
        }
    }
    SettingsGroup("网络优化", "配置属于本机内嵌服务与 APK 下载。检测不发送 Token；影片播放、115 和局域网连接不受影响。") {
        SettingsRow("GitHub", "官方优先，网络失败时尝试镜像") {
            YbSwitch(draft.githubMode == "auto", "GitHub 自动回退") { draft = draft.copy(githubMode = if (it) "auto" else "direct") }
        }
        Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
            SettingsRow("TMDB API")
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                listOf("auto" to "自动", "direct" to "主 API", "alternate" to "备用 API").forEach { (key, label) ->
                    Pill(label, selected = draft.tmdbMode == key, container = YbColor.FillSecondary) { draft = draft.copy(tmdbMode = key) }
                }
            }
        }
        draft.mirrors.forEachIndexed { index, mirror ->
            Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                Text("${index + 1}. $mirror", color = YbColor.TextSecondary, fontSize = YbText.Xs)
                Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                    if (index > 0) SecondaryButton("上移") {
                        val list = draft.mirrors.toMutableList()
                        list[index] = list[index - 1].also { list[index - 1] = list[index] }
                        draft = draft.copy(mirrors = list)
                    }
                    SecondaryButton("移除") { draft = draft.copy(mirrors = draft.mirrors.filterIndexed { i, _ -> i != index }) }
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(YbColor.FillSecondary, YbRadius.Card).padding(YbSpace.S3)) {
            RemoteTextField(value = address, onChange = { address = it }, placeholder = "添加 HTTPS 镜像地址", keyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default, onAction = {})
        }
        Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
            SecondaryButton("添加") {
                val url = address.trim().trimEnd('/') + "/"
                if (draft.mirrors.size < 5 && url !in draft.mirrors) {
                    draft = draft.copy(mirrors = draft.mirrors + url)
                    address = ""
                }
            }
            SecondaryButton("恢复内置") { draft = draft.copy(mirrors = NetworkOptions.BUILTINS) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            PrimaryButton(if (busy) "处理中…" else "保存") { perform(true) }
            SecondaryButton("测试连接") { perform(false) }
        }
        if (!loaded && result.isEmpty()) Text("正在读取网络配置…", color = YbColor.TextSecondary, fontSize = YbText.Xs)
        if (result.isNotEmpty()) Text(result, color = YbColor.TextSecondary, fontSize = YbText.Xs)
    }
}
