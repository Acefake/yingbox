package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import com.yingbox.android.settings.ImageKind
import com.yingbox.android.settings.ImageQualities
import com.yingbox.android.settings.ImageQuality
import com.yingbox.android.settings.ServerSettingsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 图片清晰度：海报、背景图、演员头像各选 标准 / 高清 / 原图（与桌面「刮削」里同一组设置）。
 * 在安卓上它决定图片从服务端取哪一档缩略图：高清是默认，标准更省流量、更快，原图最清晰。
 */
@Composable
internal fun ImageQualityGroup(api: ServerSettingsApi) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    SettingsGroup("图片清晰度", "高清是默认；标准加载更快、更省流量，原图最清晰。改了之后重新打开页面生效。") {
        for (kind in ImageKind.entries) {
            Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                SettingsRow(kind.label) {}
                Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                    for (option in ImageQuality.entries) {
                        Pill(option.label, selected = ImageQualities.get(kind) == option, container = YbColor.FillSecondary) {
                            val before = ImageQualities.get(kind)
                            if (option == before) return@Pill
                            ImageQualities.set(kind, option)
                            scope.launch {
                                val saved = withContext(Dispatchers.IO) { runCatching { api.setImageQuality(kind, option) } }
                                if (saved.isFailure) {
                                    ImageQualities.set(kind, before)
                                    Toast.makeText(context, "保存失败：${saved.exceptionOrNull()?.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
