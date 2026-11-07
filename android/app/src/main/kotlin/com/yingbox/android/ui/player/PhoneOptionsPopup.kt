package com.yingbox.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties

/**
 * 手机顶栏图标点开的浮层外壳：贴右上角、顶栏下面（沉浸式下状态栏高度为 0，位置不受影响），
 * 最高占屏 70%，内容多时可滚动；点浮层外面关闭。
 * 用独立的 focusable [Popup]：返回键与浮层外的点击先交给浮层关闭，不会漏到下面的手势层或退出播放。
 */
@Composable
internal fun PhoneTopPopup(onClose: () -> Unit, maxWidth: Dp = 260.dp, content: @Composable ColumnScope.() -> Unit) {
    val density = LocalDensity.current
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.7f).dp
    val offset = with(density) { IntOffset(-gutter().roundToPx(), 72.dp.roundToPx()) }
    Popup(alignment = Alignment.TopEnd, offset = offset, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier
                .widthIn(min = 160.dp, max = maxWidth)
                .heightIn(max = maxHeight)
                .ybGlass(YbRadius.Card, media = true)
                .verticalScroll(rememberScrollState())
                .padding(YbSpace.S2),
            content = content,
        )
    }
}

/** 浮层里的一行可选值：选中项前面打勾，不可用的项变暗且点了没反应 */
@Composable
internal fun PhonePopupItem(label: String, selected: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        (if (selected) "✓ " else "    ") + label,
        color = if (enabled) YbColor.TextPrimary else YbColor.TextTertiary,
        fontSize = YbText.Md,
        maxLines = 1,
        modifier = Modifier
            .fillMaxWidth()
            .focusFrame(shape = YbRadius.Md, selected = selected, onClick = { if (enabled) onClick() })
            .padding(YbSpace.S3),
    )
}

/** 手机顶部选项图标点开的小浮层：一组选项，选完立刻关闭 */
@Composable
internal fun PhoneOptionsPopup(group: OptionGroup, onClose: () -> Unit) {
    PhoneTopPopup(onClose) {
        Text(group.title, color = YbColor.TextSecondary, fontSize = YbText.Sm, modifier = Modifier.padding(YbSpace.S2))
        for (item in group.items) {
            PhonePopupItem(item.label, item.selected, item.enabled) {
                item.onSelect()
                onClose()
            }
        }
    }
}
