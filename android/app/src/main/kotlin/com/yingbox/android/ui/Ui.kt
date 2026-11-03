package com.yingbox.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewCard
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * 单行文本框的遥控器上下键：文本框默认把上下键当成移动光标吃掉，焦点出不来；
 * 这里让上下键移动焦点（左右键仍留给光标）。
 */
@Composable
internal fun Modifier.dpadVerticalFocus(): Modifier {
    val focus = LocalFocusManager.current
    return onPreviewKeyEvent { event ->
        val direction = when (event.key) {
            Key.DirectionDown -> FocusDirection.Down
            Key.DirectionUp -> FocusDirection.Up
            else -> null
        }
        if (direction == null) {
            false
        } else {
            if (event.type == KeyEventType.KeyDown) focus.moveFocus(direction)
            true
        }
    }
}

/** 次要文字（--text-secondary） */
internal val Muted = YbColor.TextSecondary

/** 聚焦时让整块内容（含卡片文字）避开浮动导航和屏幕边缘。 */
@Composable
internal fun Modifier.tvFocusViewport(): Modifier {
    if (!LocalIsTv.current) return this
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    var size by remember { mutableStateOf(IntSize.Zero) }
    var request by remember { mutableStateOf<Job?>(null) }
    val density = LocalDensity.current
    val top = with(density) { LocalTvFocusTopInset.current.toPx() }
    val bottom = with(density) { YbSpace.S7.toPx() }
    val side = with(density) { YbSpace.S6.toPx() }
    return this.bringIntoViewRequester(requester).onSizeChanged { size = it }.onFocusChanged { focus ->
        request?.cancel()
        request = if (focus.isFocused) scope.launch {
            requester.bringIntoView(Rect(-side, -top, size.width + side, size.height + bottom))
        } else null
    }
}

/** 电视上的静态内容可通过方向键聚焦阅读，并带动所属列表滚动。 */
@Composable
internal fun Modifier.tvReadingFocus(shape: Shape = YbRadius.Sm): Modifier {
    if (!LocalIsTv.current) return this
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    return this
        .tvFocusViewport()
        .border(if (focused) 3.dp else 0.dp, if (focused) YbColor.AccentGlow else Color.Transparent, shape)
        .focusable(interactionSource = interaction)
}

/** 分区标题：粗体大字，可点时后面跟灰色 › */
@Composable
internal fun RowTitle(text: String, more: (() -> Unit)? = null) {
    if (more == null) {
        Text(text, color = YbColor.TextPrimary, fontSize = YbText.Xl, fontWeight = FontWeight.Bold)
        return
    }
    Row(
        Modifier.tvFocusViewport().focusFrame(shape = YbRadius.Sm, onClick = more).padding(end = YbSpace.S1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = YbColor.TextPrimary, fontSize = YbText.Xl, fontWeight = FontWeight.Bold)
        Icon(YbIcons.Forward, contentDescription = null, tint = YbColor.TextTertiary, modifier = Modifier.padding(start = YbSpace.S1).size(18.dp))
    }
}

/** 页面大标题 */
@Composable
internal fun PageTitle(text: String) {
    Text(text, color = YbColor.TextPrimary, fontSize = YbText.Xl2, fontWeight = FontWeight.Bold)
}

/** 整页提示：加载中、失败 */
@Composable
internal fun Message(text: String) {
    Box(Modifier.fillMaxSize().background(YbColor.Base), contentAlignment = Alignment.Center) {
        Text(text, color = Muted, fontSize = YbText.Md)
    }
}

/**
 * 可聚焦（遥控器方向键能走到）、可点。聚焦时 3dp 强调蓝光环（--focus-ring）并略放大，
 * selected 时用 --bg-active 填底，不加边框。
 */
@Composable
internal fun Modifier.focusFrame(
    shape: Shape = YbRadius.Card,
    selected: Boolean = false,
    lift: Boolean = false,
    onClick: () -> Unit = {},
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(if (lift && focused) 1.05f else 1f, tween(150), label = "focus-lift")
    return this
        .scale(scale)
        .border(if (focused) 3.dp else 0.dp, if (focused) YbColor.AccentGlow else Color.Transparent, shape)
        .clip(shape)
        .then(if (selected) Modifier.background(YbColor.Active) else Modifier)
        .clickable(interactionSource = interaction, indication = null, onClick = onClick)
}

/** 胶囊：筛选、类型、站点、集数；selected 用 --bg-active 填底 */
@Composable
internal fun Pill(
    text: String,
    selected: Boolean = false,
    icon: ImageVector? = null,
    /** 底色：放在卡片（Elevated）里时换成 FillSecondary，否则和卡片融在一起 */
    container: Color = YbColor.Elevated,
    onClick: () -> Unit,
) {
    // 底色用卡片色，选中时再叠一层 --bg-active（叠在纯黑上的 12% 白比卡片还暗，单用会显得反了）
    Row(
        Modifier
            .height(36.dp)
            .background(container, YbRadius.Full)
            .tvFocusViewport()
            .focusFrame(shape = YbRadius.Full, selected = selected, onClick = onClick)
            .padding(horizontal = YbSpace.S4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = YbColor.TextPrimary, modifier = Modifier.padding(end = YbSpace.S2).size(16.dp))
        }
        Text(text, color = YbColor.TextPrimary, fontSize = YbText.Sm, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

/** 内容左右留白：手机 20dp，平板和电视 48dp */
@Composable
internal fun gutter(): Dp = if (LocalConfiguration.current.screenWidthDp < 600) YbSpace.S5 else YbSpace.S9

/** 轮播、详情头部的高度：宽度的 16:10（剧照是横版，竖屏也不裁成竖条）；不超过屏幕高度的 85%（留出下一行的露头） */
@Composable
internal fun heroMinHeight(): Dp {
    val config = LocalConfiguration.current
    val width = config.screenWidthDp.dp
    val height = config.screenHeightDp.dp
    return minOf(width * 10f / 16f, height * 0.85f)
}

/** 压在剧照上的暗化：顶部一点（状态栏可读），下半渐暗到页面底色 */
internal fun heroScrim(): Brush = Brush.verticalGradient(
    0f to Color(0x66000000),
    0.12f to Color.Transparent,
    0.2f to Color.Transparent,
    1f to YbColor.Base,
)

/** 压在剧照左侧的横向暗化：文字在左下，亮画面上也读得清 */
internal fun heroSideScrim(): Brush = Brush.horizontalGradient(
    0f to Color(0x99000000),
    0.6f to Color.Transparent,
)

/** 主按钮：深色下白底黑字，一个区域最多一个（比如「播放」） */
@Composable
internal fun PrimaryButton(text: String, icon: ImageVector? = null, onClick: () -> Unit) {
    Row(
        Modifier
            .height(44.dp)
            .background(YbColor.ActionBg, YbRadius.Full)
            .tvFocusViewport()
            .focusFrame(shape = YbRadius.Full, onClick = onClick)
            .padding(horizontal = YbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = YbColor.ActionText, modifier = Modifier.padding(end = YbSpace.S2).size(18.dp))
        }
        Text(text, color = YbColor.ActionText, fontSize = YbText.Md, fontWeight = FontWeight.SemiBold)
    }
}

/** 次按钮：和主按钮同高同字号，深灰底（和 PrimaryButton 并排用）；selected 叠 --bg-active */
@Composable
internal fun SecondaryButton(text: String, icon: ImageVector? = null, selected: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier
            .height(44.dp)
            .background(YbColor.Elevated, YbRadius.Full)
            .tvFocusViewport()
            .focusFrame(shape = YbRadius.Full, selected = selected, onClick = onClick)
            .padding(horizontal = YbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = YbColor.TextPrimary, modifier = Modifier.padding(end = YbSpace.S2).size(18.dp))
        }
        Text(text, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.SemiBold)
    }
}

/** 一张竖版海报卡：海报（--radius-card）、片名、年份 · 评分 */
@Composable
internal fun Poster(card: ViewCard, client: ServerClient, modifier: Modifier = Modifier, open: () -> Unit) {
    Column(modifier.width(132.dp).tvFocusViewport(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        RemoteImage(
            card.poster,
            client,
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).focusFrame(lift = true, onClick = open).clip(YbRadius.Card),
        )
        Text(card.title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(listOf(card.year, card.rate).filter { it.isNotEmpty() }.joinToString(" · "), color = Muted, fontSize = YbText.Xs)
    }
}
