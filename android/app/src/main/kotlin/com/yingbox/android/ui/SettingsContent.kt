package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.settings.MetadataLanguage
import com.yingbox.android.settings.ServerSettingsApi
import com.yingbox.android.update.UpdateController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 分类内容沿用原有设置键、保存接口和失败回滚。 */
@Composable
internal fun SettingsContent(section: SettingsSection, client: ServerClient, device: DeviceSettings, updates: UpdateController) {
    val context = LocalContext.current
    val scope = rememberSettingsScope()
    val api = remember(client) { ServerSettingsApi(client) }
    // 取到之前不显示选中；改失败时退回改之前的值
    val loaded by produceState<MetadataLanguage?>(null, client, section) {
        if (section != SettingsSection.Scrape) return@produceState
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
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S5),
    ) {
        item {
            SettingsCard {
                when (section) {
                    SettingsSection.Appearance -> {
                        SettingsGroup("外观", "关闭背景模糊，导航栏和返回按钮改用实色；低配设备、电视上更流畅。") {
                            Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                                SettingsRow("品牌配色", "图标和影盒字标跟随当前设备，默认紫水晶")
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                                    Image(painterResource(device.brandColor.icon), contentDescription = device.brandColor.label, modifier = Modifier.size(48.dp))
                                    Image(painterResource(device.brandColor.wordmark), contentDescription = "影盒", modifier = Modifier.width(96.dp).height(44.dp))
                                }
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                                    items(BrandColor.entries) { color ->
                                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                                            Image(painterResource(color.icon), contentDescription = null, modifier = Modifier.size(32.dp))
                                            Pill(color.label, selected = color == device.brandColor, container = YbColor.FillSecondary) {
                                                device.updateBrandColor(color)
                                            }
                                        }
                                    }
                                }
                            }
                            SettingsRow("降低透明度") {
                                YbSwitch(device.reduceTransparency, "降低透明度", device::updateReduceTransparency)
                            }
                        }
                    }
                    SettingsSection.Player -> {
                        SettingsGroup("播放") {
                            SettingsRow("自动播放下一集", "关闭后播完一集回到详情页") {
                                YbSwitch(device.autoNext, "自动播放下一集", device::updateAutoNext)
                            }
                            SettingsRow("自动换源", "播放出错或卡住 12 秒时，换到别的站点接着播") {
                                YbSwitch(device.autoSwitchSource, "自动换源", device::updateAutoSwitchSource)
                            }
                        }
                    }
                    SettingsSection.Scrape -> {
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
                        SettingsDivider()
                        ImageQualityGroup(api)
                        SettingsDivider()
                        TmdbTokenGroup(api)
                    }
                    SettingsSection.Network -> NetworkSettingsGroup(api, device)
                    SettingsSection.Sources -> SourcesGroup(client)
                    SettingsSection.Nas -> NasGroup(device)
                    SettingsSection.About -> AboutGroup(updates)
                }
            }
        }
    }
}
