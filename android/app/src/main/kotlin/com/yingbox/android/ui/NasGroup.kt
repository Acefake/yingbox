package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.yingbox.android.library.NasConfig
import com.yingbox.android.library.NasProbe
import com.yingbox.android.library.NasStatus
import com.yingbox.android.library.normalizeNasUrl
import com.yingbox.android.settings.DeviceSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * NAS：填上 NAS 里影盒服务的地址和令牌，导航里就多出「片库」，可以直放 NAS 上的文件（ADR-0040）。
 * 令牌随明文 HTTP 传输，只在可信的局域网里使用。
 */
@Composable
internal fun NasGroup(device: DeviceSettings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var url by remember { mutableStateOf(device.nas?.url.orEmpty()) }
    var token by remember { mutableStateOf(device.nas?.token.orEmpty()) }
    var status by remember { mutableStateOf<NasStatus?>(null) }
    var testing by remember { mutableStateOf(false) }

    fun saveAndTest() {
        if (testing) return
        val normalized = normalizeNasUrl(url)
        if (normalized == null) {
            Toast.makeText(context, "地址不合法，例如 192.168.1.5:31480", Toast.LENGTH_SHORT).show()
            return
        }
        keyboard?.hide()
        url = normalized
        val config = NasConfig(normalized, token.trim())
        device.updateNas(config)
        testing = true
        status = null
        scope.launch {
            status = withContext(Dispatchers.IO) { NasProbe.check(config) }
            testing = false
        }
    }

    SettingsGroup("NAS", "填上 NAS 里影盒服务的地址和令牌，导航里会多出「片库」，直放 NAS 上的文件。令牌通过明文 HTTP 传输，只在可信的局域网里使用。") {
        SettingsRow("状态") {
            Text(
                when {
                    testing -> "测试中…"
                    status != null -> status!!.label
                    device.nas != null -> "已保存"
                    else -> "未配置"
                },
                color = if (status == NasStatus.Ok) YbColor.Success else YbColor.TextSecondary,
                fontSize = YbText.Sm,
            )
        }
        FieldBox {
            RemoteTextField(
                value = url,
                onChange = { url = it.filterNot(Char::isWhitespace) },
                placeholder = "地址，如 192.168.1.5:31480",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                onAction = {},
            )
        }
        FieldBox {
            RemoteTextField(
                value = token,
                onChange = { token = it.filterNot(Char::isWhitespace) },
                placeholder = "令牌（服务没开鉴权可不填）",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                onAction = { saveAndTest() },
                visualTransformation = PasswordVisualTransformation(),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            PrimaryButton(if (testing) "测试中…" else "保存并测试") { saveAndTest() }
            if (device.nas != null) {
                SecondaryButton("清除") {
                    device.clearNas()
                    url = ""
                    token = ""
                    status = null
                }
            }
        }
    }
}

@Composable
private fun FieldBox(content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(44.dp).background(YbColor.FillSecondary, YbRadius.Full).padding(horizontal = YbSpace.S4),
        contentAlignment = Alignment.CenterStart,
    ) { content() }
}
