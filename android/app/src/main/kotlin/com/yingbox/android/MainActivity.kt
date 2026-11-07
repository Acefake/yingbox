package com.yingbox.android

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yingbox.android.server.LocalServer
import com.yingbox.android.server.ServerClient
import com.yingbox.android.server.ServerService
import com.yingbox.android.server.ServerState
import com.yingbox.android.library.LibraryCard
import com.yingbox.android.playback.PlayTitle
import com.yingbox.android.ui.BackButton
import com.yingbox.android.ui.BrowseScreen
import com.yingbox.android.ui.FavoritesScreen
import com.yingbox.android.ui.LocalBrandColor
import com.yingbox.android.settings.DeviceSettings
import com.yingbox.android.settings.ImageQualities
import com.yingbox.android.settings.ServerSettingsApi
import com.yingbox.android.ui.LibraryBrowse
import com.yingbox.android.ui.LibraryDetailScreen
import com.yingbox.android.ui.LibraryPlayRequest
import com.yingbox.android.ui.LibraryPlayerScreen
import com.yingbox.android.ui.LibraryScreen
import com.yingbox.android.ui.LocalHaze
import com.yingbox.android.ui.LocalSettingsScope
import com.yingbox.android.ui.LogoSplash
import com.yingbox.android.ui.Message
import com.yingbox.android.ui.SPLASH_INTRO_MS
import com.yingbox.android.ui.LocalIsTv
import com.yingbox.android.ui.LocalTvFocusTopInset
import com.yingbox.android.ui.belowBackButton
import com.yingbox.android.ui.TvBringIntoViewSpec
import com.yingbox.android.ui.LocalReduceTransparency
import com.yingbox.android.ui.SearchScreen
import com.yingbox.android.ui.SettingsScreen
import com.yingbox.android.ui.UpdatePrompt
import com.yingbox.android.update.UpdateController
import com.yingbox.android.ui.NavCapsule
import com.yingbox.android.ui.RecentScreen
import com.yingbox.android.ui.Tab
import com.yingbox.android.ui.YbColor
import com.yingbox.android.ui.chromePadding
import com.yingbox.android.ui.useTopNav
import com.yingbox.android.ui.DetailScreen
import com.yingbox.android.ui.DetailTarget
import com.yingbox.android.ui.HomeActions
import com.yingbox.android.ui.HomeScreen
import com.yingbox.android.ui.PlayRequest
import com.yingbox.android.ui.PlayerScreen
import com.yingbox.android.view.BrowseTarget
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewCard
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 入口：启动内嵌服务；就绪后进首页（首页 → 详情 → 播放，返回键逐层退回），之前显示服务状态。 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 内容铺到状态栏下面：轮播、剧照从最顶上开始，浮动控件自己让出状态栏
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
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

/** 页面栈里的一页：一级页面（导航胶囊切换）+ 二级页面（左上角返回） */
private sealed interface Screen {
    data class Top(val tab: Tab) : Screen

    data class Browse(val target: BrowseTarget) : Screen

    data class Detail(val target: DetailTarget) : Screen

    data class Play(val request: PlayRequest) : Screen

    data class LibraryDetail(val card: LibraryCard) : Screen

    data class LibraryPlay(val request: LibraryPlayRequest) : Screen
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun App(isTv: Boolean) {
    val brandContext = LocalContext.current
    val device = remember { DeviceSettings(brandContext) }
    val state by LocalServer.state.collectAsState()
    val ready = state as? ServerState.Ready
    // 服务启动很快（约 2 秒），启动页至少显示到入场动画播完（启动失败立即显示原因，不等）
    var splashDone by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(SPLASH_INTRO_MS + 300L)
        splashDone = true
    }
    if (ready == null || (!splashDone && state !is ServerState.Failed)) {
        CompositionLocalProvider(LocalBrandColor provides device.brandColor) { StatusScreen(state) }
        return
    }
    val client = remember(ready) { ServerClient(ready) }
    // 启动时取一次图片清晰度设置（取不到就用高清，不影响显示）
    LaunchedEffect(client) {
        withContext(Dispatchers.IO) { runCatching { ServerSettingsApi(client).imageQualities() } }
            .getOrNull()?.forEach { (kind, quality) -> ImageQualities.set(kind, quality) }
    }
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Top(Tab.Home))) }
    val scope = rememberCoroutineScope()
    val settingsScope = rememberCoroutineScope()
    val context = LocalContext.current
    val updates = remember(client) { UpdateController(context.applicationContext, client, scope) }
    LaunchedEffect(updates) { updates.checkOnLaunch() }
    var resuming by remember { mutableStateOf(false) }
    // 从详情、播放返回首页时回到原来的滚动位置
    val homeScroll = rememberLazyListState()
    val detailScroll = remember(stack.filterIsInstance<Screen.Detail>().lastOrNull()) {
        LazyListState()
    }
    val contentFocus = remember { FocusRequester() }
    // 电视刚打开时没有任何焦点，遥控器第一下方向键只会落到导航栏；内容出来后把焦点放进首页（只做这一次）
    LaunchedEffect(Unit) {
        if (!isTv) return@LaunchedEffect
        repeat(20) {
            delay(400)
            if (runCatching { contentFocus.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
        }
    }
    val haze = remember { HazeState() }
    // NAS 上的影盒服务（设置里配置后才有）；片库、片库播放都走它，在线内容仍走内嵌服务
    val nas = device.nas
    val nasClient = remember(nas) { nas?.let { ServerClient(ServerState.Ready(it.url, it.token)) } }
    val libraryBrowse = remember(nas) { LibraryBrowse() }
    val tabs = Tab.entries.filter { it != Tab.Library || nasClient != null }
    val topNav = useTopNav(isTv)
    val chrome = chromePadding(topNav)
    val push = { screen: Screen -> stack = stack + screen }
    val back = { stack = stack.dropLast(1) }
    // 二级页面退一层；「最近播放」「收藏」先回首页，首页再按才退出应用
    val atOtherTab = (stack.singleOrNull() as? Screen.Top)?.tab.let { it != null && it != Tab.Home }
    BackHandler(enabled = stack.size > 1 || atOtherTab) {
        stack = if (stack.size > 1) stack.dropLast(1) else listOf(Screen.Top(Tab.Home))
    }

    val openCard = { card: ViewCard ->
        push(Screen.Detail(DetailTarget(card.id, card.kind, card.title, card.searchTitle, card.poster, card.backdrop)))
    }
    val resume: (String) -> Unit = resume@{ id ->
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
    }

    CompositionLocalProvider(
        LocalBrandColor provides device.brandColor,
        LocalHaze provides haze,
        LocalSettingsScope provides settingsScope,
        LocalReduceTransparency provides device.reduceTransparency,
        LocalIsTv provides isTv,
        LocalTvFocusTopInset provides if (stack.last() is Screen.Top) chrome.calculateTopPadding() else belowBackButton(),
        LocalBringIntoViewSpec provides if (isTv) TvBringIntoViewSpec else LocalBringIntoViewSpec.current,
    ) {
        Box(Modifier.fillMaxSize().background(YbColor.Base)) {
            // 页面内容是玻璃的模糊来源
            Box(Modifier.fillMaxSize().hazeSource(haze).focusRequester(contentFocus).focusGroup()) {
                when (val top = stack.last()) {
                    is Screen.Top -> when (top.tab) {
                        Tab.Home -> HomeScreen(client, homeScroll, chrome, HomeActions(openCard, resume) { push(Screen.Browse(it)) })
                        Tab.Search -> SearchScreen(client, chrome) { card ->
                            push(Screen.Detail(DetailTarget(null, null, card.title, card.title, card.poster)))
                        }
                        Tab.Library -> nasClient?.let { nasApi ->
                            LibraryScreen(nasApi, libraryBrowse, chrome, { stack = listOf(Screen.Top(Tab.Settings)) }) { push(Screen.LibraryDetail(it)) }
                        } ?: Message("先在设置里配置 NAS")
                        Tab.Recent -> RecentScreen(client, chrome, resume)
                        Tab.Favorites -> FavoritesScreen(client, chrome, openCard)
                        Tab.Settings -> SettingsScreen(client, device, chrome, updates)
                    }
                    is Screen.Browse -> BrowseScreen(client, top.target, openCard)
                    is Screen.Detail -> DetailScreen(client, top.target, detailScroll) { push(Screen.Play(it)) }
                    is Screen.Play -> PlayerScreen(client, top.request, device.autoNext, device.autoSwitchSource) { back() }
                    is Screen.LibraryDetail -> nasClient?.let { nasApi ->
                        LibraryDetailScreen(nasApi, top.card) { push(Screen.LibraryPlay(it)) }
                    } ?: Message("先在设置里配置 NAS")
                    is Screen.LibraryPlay -> nasClient?.let { nasApi ->
                        LibraryPlayerScreen(nasApi, top.request, device.autoNext) { back() }
                    } ?: Message("先在设置里配置 NAS")
                }
            }
            when (val top = stack.last()) {
                // 一级页面之间切换不进栈
                is Screen.Top -> NavCapsule(top.tab, tabs, topNav, contentFocus, onFocused = {
                    if (isTv && top.tab == Tab.Home) homeScroll.requestScrollToItem(0)
                }) { stack = listOf(Screen.Top(it)) }
                // 全屏播放不画返回按钮：用系统返回键、返回手势或遥控器的返回键退出
                is Screen.Play, is Screen.LibraryPlay -> Unit
                else -> BackButton(contentFocus, onFocused = {
                    if (isTv && top is Screen.Detail) detailScroll.requestScrollToItem(0)
                }) { back() }
            }
            UpdatePrompt(updates)
        }
    }
}

@Composable
private fun StatusScreen(state: ServerState) {
    val failed = state as? ServerState.Failed
    LogoSplash(describe(state), failed?.logTail?.takeLast(8).orEmpty(), failed = failed != null)
}

private fun describe(state: ServerState): String = when (state) {
    is ServerState.Starting -> if (state.attempt == 1) "服务启动中…" else "服务重启中（第 ${state.attempt} 次）…"
    is ServerState.Ready -> "服务已就绪"
    is ServerState.Failed -> "服务启动失败：${state.message}"
    ServerState.Stopped -> "服务未运行"
}
