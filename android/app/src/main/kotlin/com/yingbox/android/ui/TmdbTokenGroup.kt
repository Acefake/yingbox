package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.yingbox.android.settings.ServerSettingsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * TMDB 令牌（Read Access Token）：配置后首页、详情用 TMDB 补中文片名、海报和剧照。
 * 令牌明文只写不读：输入框永远是空的，状态只显示「已配置 / 未配置」；保存在服务端的密钥文件里。
 */
@Composable
internal fun TmdbTokenGroup(api: ServerSettingsApi) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val loaded by produceState<Boolean?>(null, api) {
        value = withContext(Dispatchers.IO) { runCatching { api.tmdbConfigured() }.getOrNull() }
    }
    var changed by remember { mutableStateOf<Boolean?>(null) }
    val configured = changed ?: loaded
    var draft by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    fun save(token: String) {
        if (saving) return
        saving = true
        keyboard?.hide()
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.setTmdbToken(token) } }
            saving = false
            result.onSuccess {
                changed = it
                draft = ""
                Toast.makeText(context, if (token.isBlank()) "已清除 TMDB 令牌" else "已保存，重新打开首页生效", Toast.LENGTH_SHORT).show()
            }.onFailure { Toast.makeText(context, "保存失败：${it.message}", Toast.LENGTH_SHORT).show() }
        }
    }

    SettingsGroup("TMDB", "到 themoviedb.org/settings/api 获取 Read Access Token；配置后首页和详情用 TMDB 补中文片名、海报与剧照。令牌只保存在本机服务里，不会显示。") {
        SettingsRow("状态") {
            Text(
                when (configured) {
                    true -> "已配置"
                    false -> "未配置"
                    null -> "读取中…"
                },
                color = if (configured == true) YbColor.Success else YbColor.TextSecondary,
                fontSize = YbText.Sm,
            )
        }
        Box(
            Modifier.fillMaxWidth().height(44.dp).background(YbColor.FillSecondary, YbRadius.Full).padding(horizontal = YbSpace.S4),
            contentAlignment = Alignment.CenterStart,
        ) {
            RemoteTextField(
                value = draft,
                onChange = { draft = it.filterNot(Char::isWhitespace) },
                placeholder = "粘贴 Access Token",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                onAction = { if (draft.isNotEmpty()) save(draft) },
                visualTransformation = PasswordVisualTransformation(),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            PrimaryButton(if (saving) "保存中…" else "保存") { if (draft.isNotEmpty()) save(draft) }
            if (configured == true) SecondaryButton("清除") { save("") }
        }
    }
}
