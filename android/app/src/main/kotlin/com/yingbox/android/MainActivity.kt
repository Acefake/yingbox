package com.yingbox.android

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.server.LocalServer
import com.yingbox.android.server.ServerClient
import com.yingbox.android.server.ServerService
import com.yingbox.android.server.ServerState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 入口：启动内嵌服务，显示设备模式和服务状态，就绪后读一次 /api/info。
 * 首页、播放器按 ADR-0028 的阶段接入。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServerService.acquire(this)
        val isTv = isTelevision()
        setContent { StatusScreen(isTv) }
    }

    override fun onDestroy() {
        ServerService.release(this)
        super.onDestroy()
    }

    private fun isTelevision(): Boolean {
        val uiMode = getSystemService(UiModeManager::class.java)
        return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }
}

@Composable
private fun StatusScreen(isTv: Boolean) {
    val state by LocalServer.state.collectAsState()
    var info by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state) {
        val ready = state as? ServerState.Ready ?: return@LaunchedEffect
        info = withContext(Dispatchers.IO) {
            runCatching { ServerClient(ready).get("/api/info") }.getOrElse { "读取失败：$it" }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .padding(48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = "影盒", color = Color.White, fontSize = 48.sp)
        Text(
            text = if (isTv) "电视模式" else "手机模式",
            color = Color.White,
            fontSize = 20.sp,
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            text = describe(state),
            color = Color.Gray,
            fontSize = 16.sp,
            modifier = Modifier.padding(top = 32.dp),
        )
        if (state is ServerState.Ready) info?.let {
            Text(it, color = Color.Gray, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
        (state as? ServerState.Failed)?.logTail?.takeLast(8)?.forEach {
            Text(it, color = Color.Gray, fontSize = 12.sp)
        }
    }
}

private fun describe(state: ServerState): String = when (state) {
    is ServerState.Starting -> if (state.attempt == 1) "服务启动中…" else "服务重启中（第 ${state.attempt} 次）…"
    is ServerState.Ready -> "服务已就绪：${state.baseUrl}"
    is ServerState.Failed -> "服务启动失败：${state.message}"
    ServerState.Stopped -> "服务未运行"
}
