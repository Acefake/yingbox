package com.yingbox.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** 主导航的一项（只放已经能用的页面；搜索、片库、设置做好后加进来） */
enum class Tab(val label: String, val icon: ImageVector) {
    Home("首页", YbIcons.Home),
    Search("搜索", YbIcons.Search),
    Library("片库", YbIcons.Play),
    Recent("最近播放", YbIcons.History),
    Favorites("收藏", YbIcons.HeartFill),
    Settings("设置", YbIcons.Settings),
}

/** 导航放顶部：电视，以及宽屏（平板、手机横屏，宽度 600dp 起）；竖屏手机放底部 */
@Composable
fun useTopNav(isTv: Boolean): Boolean = isTv || LocalConfiguration.current.screenWidthDp >= 600

/** 页面要给浮动导航和系统栏让出的空间：导航在顶部时让出顶部，在底部时让出底部 */
@Composable
fun chromePadding(topNav: Boolean): PaddingValues {
    val bars = WindowInsets.systemBars.asPaddingValues()
    val top = bars.calculateTopPadding()
    val bottom = bars.calculateBottomPadding()
    return if (topNav) PaddingValues(top = top + 96.dp, bottom = bottom + YbSpace.S7) else PaddingValues(top = top + YbSpace.S2, bottom = bottom + 96.dp)
}

/**
 * 主导航：浮在内容上的玻璃胶囊。手机在底部（图标在上、文字在下），电视在顶部（图标 + 文字一行，
 * 遥控器左右切换）。选中项用 --bg-active 填底，不加边框。
 */
@Composable
fun BoxScope.NavCapsule(current: Tab, tabs: List<Tab>, top: Boolean, contentFocus: FocusRequester, onFocused: () -> Unit, select: (Tab) -> Unit) {
    val place = if (top) {
        Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = YbSpace.S3)
    } else {
        Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = YbSpace.S3)
    }
    Row(
        place.ybGlass(YbRadius.Full).padding(YbSpace.S1),
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S1),
    ) {
        for (tab in tabs) {
            val selected = tab == current
            val item = Modifier.onFocusChanged { if (it.isFocused) onFocused() }.focusProperties {
                if (top) {
                    down = contentFocus
                    // 导航两端按左右键停住，不要溜进下面的内容
                    if (tab == tabs.last()) right = FocusRequester.Cancel
                    if (tab == tabs.first()) left = FocusRequester.Cancel
                }
            }.focusFrame(shape = YbRadius.Full, selected = selected) { select(tab) }
            if (top) {
                Row(
                    item.padding(horizontal = YbSpace.S5, vertical = YbSpace.S3),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(tab.icon, contentDescription = null, tint = YbColor.TextPrimary, modifier = Modifier.size(20.dp))
                    Text(
                        tab.label,
                        color = YbColor.TextPrimary,
                        fontSize = YbText.Md,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(start = YbSpace.S2),
                    )
                }
            } else {
                Column(
                    item.width(if (tabs.size > 5) 60.dp else 68.dp).padding(vertical = YbSpace.S2),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        tab.icon,
                        contentDescription = null,
                        tint = if (selected) YbColor.TextPrimary else YbColor.TextSecondary,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(
                        tab.label,
                        color = if (selected) YbColor.TextPrimary else YbColor.TextSecondary,
                        fontSize = YbText.Xs2,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

/** 二级页面标题、头部内容要避开返回圆钮：状态栏 + 12dp 上边距 + 44dp 按钮 + 16dp 间隔 */
@Composable
fun belowBackButton(): Dp = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 72.dp

/** 二级页面左上角的返回圆钮（系统返回键、遥控器返回键也能退） */
@Composable
fun BoxScope.BackButton(contentFocus: FocusRequester, media: Boolean = false, onFocused: () -> Unit = {}, back: () -> Unit) {
    Box(Modifier.align(Alignment.TopStart).statusBarsPadding().displayCutoutPadding().padding(start = gutter(), top = YbSpace.S3)
        .onFocusChanged { if (it.isFocused) onFocused() }.focusProperties { down = contentFocus }) {
        GlassIconButton(YbIcons.Back, "返回", media = media, onClick = back)
    }
}
