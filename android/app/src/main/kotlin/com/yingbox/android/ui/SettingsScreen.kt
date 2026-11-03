package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import com.yingbox.android.server.ServerClient
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.settings.MetadataLanguage
import com.yingbox.android.settings.ServerSettingsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 设置页（ADR-0033）：外观、播放是这台设备的设置，存本机；元数据语言是服务端设置，
 * 与桌面、网页端同一个键。TMDB 令牌、片库、网盘等随对应功能搬过来时再加。
 */
@Composable
fun SettingsScreen(client: ServerClient, device: DeviceSettings, chrome: PaddingValues) {
    val dir = LocalLayoutDirection.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val api = remember(client) { ServerSettingsApi(client) }
    // 取到之前不显示选中；改失败时退回改之前的值
    val loaded by produceState<MetadataLanguage?>(null, client) {
        // 刚进页面时服务可能还在忙，隔一会儿再取，最多 3 次
        for (wait in longArrayOf(0, 1_500, 4_000)) {
            delay(wait)
            value = withContext(Dispatchers.IO) { runCatching { api.metadataLanguage() }.getOrNull() }
            if (value != null) return@produceState
        }
    }
    var picked by remember { mutableStateOf<MetadataLanguage?>(null) }
    // 一次只存一个：保存中再点会让回滚和落盘顺序对不上
    var saving by remember { mutableStateOf(false) }
    val language = picked ?: loaded
    val version = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty()
    }
    val gutter = gutter()
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(
            start = gutter + chrome.calculateStartPadding(dir),
            end = gutter + chrome.calculateEndPadding(dir),
            top = chrome.calculateTopPadding(),
            bottom = chrome.calculateBottomPadding(),
        ),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S6),
    ) {
        item { PageTitle("设置") }
        item {
            SettingsGroup("外观", "关闭背景模糊，导航栏和返回按钮改用实色；低配设备、电视上更流畅。") {
                SettingsRow("降低透明度") {
                    YbSwitch(device.reduceTransparency, "降低透明度", device::updateReduceTransparency)
                }
            }
        }
        item {
            SettingsGroup("播放") {
                SettingsRow("自动播放下一集", "关闭后播完一集回到详情页") {
                    YbSwitch(device.autoNext, "自动播放下一集", device::updateAutoNext)
                }
                SettingsRow("自动换源", "播放出错或卡住 12 秒时，换到别的站点接着播") {
                    YbSwitch(device.autoSwitchSource, "自动换源", device::updateAutoSwitchSource)
                }
            }
        }
        item {
            SettingsGroup("元数据", "首页和详情的标题、简介用这个语言；与桌面端、网页端共用。") {
                Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                SettingsRow("语言")
                LazyRow(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                    items(MetadataLanguage.entries) { option ->
                        Pill(option.label, selected = option == language, container = YbColor.FillSecondary) {
                            val before = language
                            if (before == null || option == before || saving) return@Pill
                            picked = option
                            saving = true
                            scope.launch {
                                val saved = withContext(Dispatchers.IO) { runCatching { api.setMetadataLanguage(option) } }
                                saving = false
                                if (saved.isFailure) {
                                    picked = before
                                    Toast.makeText(context, "保存失败：${saved.exceptionOrNull()?.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                }
                }
            }
        }
        item { TmdbTokenGroup(api) }
        item {
            SettingsGroup("关于") {
                SettingsRow("版本") { Text(version, color = YbColor.TextSecondary, fontSize = YbText.Sm) }
            }
        }
    }
}
