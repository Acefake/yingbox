package com.yingbox.android

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.server.LocalServer
import com.yingbox.android.server.ServerClient
import com.yingbox.android.server.ServerService
import com.yingbox.android.server.ServerState
import com.yingbox.android.playback.PlayTitle
import com.yingbox.android.ui.DetailScreen
import com.yingbox.android.ui.DetailTarget
import com.yingbox.android.ui.HomeActions
import com.yingbox.android.ui.HomeScreen
import com.yingbox.android.ui.PlayRequest
import com.yingbox.android.ui.PlayerScreen
import com.yingbox.android.view.ViewApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 入口：启动内嵌服务；就绪后进首页（首页 → 详情 → 播放，返回键逐层退回），之前显示服务状态。 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServerService.acquire(this)
        val isTv = isTelevision()
        setContent { App(isTv) }
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

/** 页面栈里的一页 */
private sealed interface Screen {
    data object Home : Screen

    data class Detail(val target: DetailTarget) : Screen

    data class Play(val request: PlayRequest) : Screen
}

@Composable
private fun App(isTv: Boolean) {
    val state by LocalServer.state.collectAsState()
    val ready = state as? ServerState.Ready
    if (ready == null) {
        StatusScreen(state, isTv)
        return
    }
    val client = remember(ready) { ServerClient(ready) }
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Home)) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var resuming by remember { mutableStateOf(false) }
    // 从详情、播放返回首页时回到原来的滚动位置
    val homeScroll = rememberLazyListState()
    val push = { screen: Screen -> stack = stack + screen }
    BackHandler(enabled = stack.size > 1) { stack = stack.dropLast(1) }

    when (val top = stack.last()) {
        Screen.Home -> HomeScreen(
            client,
            homeScroll,
            HomeActions(
                openCard = { card ->
                    push(Screen.Detail(DetailTarget(card.id, card.kind, card.title, card.searchTitle, card.poster)))
                },
                resume = resume@{ id ->
                    // 遥控器连按确定时只开一个播放器
                    if (resuming) return@resume
                    resuming = true
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { runCatching { ViewApi(client).resume(id) }.getOrNull() }
                        resuming = false
                        if (r == null) {
                            Toast.makeText(context, "这条记录播不了了，从详情重新选源吧", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val title = PlayTitle(r.title, r.key, r.cover, r.doubanId, r.kind)
                        push(Screen.Play(PlayRequest(title, r.episodes, r.index.toInt())))
                    }
                },
            ),
        )
        is Screen.Detail -> DetailScreen(client, top.target) { push(Screen.Play(it)) }
        is Screen.Play -> PlayerScreen(client, top.request) { stack = stack.dropLast(1) }
    }
}

@Composable
private fun StatusScreen(state: ServerState, isTv: Boolean) {
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
        (state as? ServerState.Failed)?.logTail?.takeLast(8)?.forEach {
            Text(it, color = Color.Gray, fontSize = 12.sp)
        }
    }
}

private fun describe(state: ServerState): String = when (state) {
    is ServerState.Starting -> if (state.attempt == 1) "服务启动中…" else "服务重启中（第 ${state.attempt} 次）…"
    is ServerState.Ready -> "服务已就绪"
    is ServerState.Failed -> "服务启动失败：${state.message}"
    ServerState.Stopped -> "服务未运行"
}
