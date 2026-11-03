package com.yingbox.android.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewSourceHealth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 数据源管理，与桌面一样自动：服务启动时把全部源跑一遍，通的启用、不通的停用，搜索、选源、自动换源只用启用的。
 * 这里显示检测进度和停用的站点，可以重新检测；以前手动屏蔽过的站点也列在这里，可以恢复。
 */
@Composable
internal fun SourcesGroup(client: ServerClient) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val api = remember(client) { ViewApi(client) }
    var health by remember { mutableStateOf<ViewSourceHealth?>(null) }
    var blocked by remember { mutableStateOf<List<String>?>(null) }
    // 检测中每秒刷新一次进度；没在检测就慢一点看看（服务刚启动时第一轮在几秒后才开始）
    LaunchedEffect(client) {
        blocked = withContext(Dispatchers.IO) { runCatching { api.blockedSites() }.getOrNull() }
        while (true) {
            health = withContext(Dispatchers.IO) { runCatching { api.sourceHealth() }.getOrNull() } ?: health
            delay(if (health?.checking == true) 1_000 else 4_000)
        }
    }
    val summary = when {
        health == null -> "读取中…"
        health!!.checking -> "检测中 ${health!!.done.toInt()} / ${health!!.total.toInt()}"
        health!!.total.toInt() == 0 -> "还没有检测过，稍后会自动检测"
        else -> "已检测 ${health!!.total.toInt()} 个，停用 ${health!!.failed.size} 个"
    }
    SettingsGroup(
        "数据源",
        "和桌面端一样自动管理：把全部源跑一遍，能用的启用，不通的停用；搜索、选源、自动换源只用启用的。服务每次启动会自动检测一轮。",
    ) {
        SettingsRow("检测结果", summary) {
            SecondaryButton(if (health?.checking == true) "检测中…" else "重新检测") {
                if (health?.checking == true) return@SecondaryButton
                scope.launch {
                    health = withContext(Dispatchers.IO) { runCatching { api.recheckSources() }.getOrNull() } ?: health
                }
            }
        }
        val failed = health?.failed.orEmpty()
        if (failed.isNotEmpty()) {
            SettingsRow("已停用（检测不通）", failed.joinToString("、"), modifier = Modifier.tvReadingFocus())
        }
        val names = blocked.orEmpty()
        if (names.isEmpty()) {
            Text("没有手动屏蔽的站点", color = YbColor.TextTertiary, fontSize = YbText.Xs)
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
                Text("手动屏蔽的站点", color = YbColor.TextSecondary, fontSize = YbText.Sm)
                for (name in names) {
                    SettingsRow(name) {
                        SecondaryButton("恢复") {
                            scope.launch {
                                val next = withContext(Dispatchers.IO) { runCatching { api.blockSite(name, false) } }
                                next.onSuccess { blocked = it }
                                    .onFailure { Toast.makeText(context, "恢复失败：${it.message}", Toast.LENGTH_SHORT).show() }
                            }
                        }
                    }
                }
            }
        }
    }
}
