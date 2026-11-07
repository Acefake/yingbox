package com.yingbox.android.ui

import android.widget.Toast

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.update.UpdateController
import com.yingbox.android.view.ViewApi
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 分类设置：手机逐级进入，平板与电视左右分栏；设备与服务端设置沿用各自的存储规则。 */
@Composable
fun SettingsScreen(client: ServerClient, device: DeviceSettings, chrome: PaddingValues, updates: UpdateController) {
    val layout = currentLayout()
    val context = LocalContext.current
    val operations = rememberSettingsScope()
    fun canLeave(): Boolean {
        if (canLeaveSettings(operations)) return true
        Toast.makeText(context, "正在处理设置，请稍候", Toast.LENGTH_SHORT).show()
        return false
    }
    val wide = layout != AdaptiveLayout.Phone
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val active = SettingsSection.entries.firstOrNull { it.name == selected }
        ?: if (wide) SettingsSection.Appearance else null
    var contentFocused by remember { mutableStateOf(false) }
    var enterContent by remember { mutableStateOf(false) }
    val categoriesFocus = remember { FocusRequester() }
    val contentFocus = remember { FocusRequester() }
    val backgroundHaze = remember { HazeState() }
    val background by produceState<String?>(null, client) {
        value = withContext(Dispatchers.IO) { runCatching { ViewApi(client).home().hero.firstOrNull()?.image }.getOrNull() }
    }

    BackHandler(enabled = (!wide && active != null) || (wide && contentFocused)) {
        if (wide) categoriesFocus.requestFocus() else if (canLeave()) selected = null
    }
    LaunchedEffect(active, enterContent, wide) {
        if (wide && enterContent) {
            contentFocus.requestFocus()
            enterContent = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        // 面板只采样背景层，避免把自身纳入模糊来源。
        Box(Modifier.fillMaxSize().hazeSource(backgroundHaze).background(YbColor.Base)) {
            background?.let { RemoteImage(it, client, Modifier.fillMaxSize()) }
            Box(Modifier.fillMaxSize().background(YbColor.Base.copy(alpha = 0.55f)))
        }
        CompositionLocalProvider(LocalHaze provides backgroundHaze, LocalTvFocusTopInset provides 0.dp) {
            Column(
                Modifier.fillMaxSize().padding(chrome)
                    .padding(horizontal = if (wide) YbSpace.S6 else YbSpace.S2, vertical = YbSpace.S3)
                    .ybGlass(YbRadius.Xl2),
            ) {
                SettingsFrame(
                    layout, active, categoriesFocus, contentFocus,
                    onContentFocus = { contentFocused = it },
                    onBack = { if (canLeave()) selected = null },
                    onSelect = { if (it == active || canLeave()) { selected = it.name; enterContent = wide } },
                ) { section -> key(section, client) { SettingsContent(section, client, device, updates) } }
            }
        }
    }
}
