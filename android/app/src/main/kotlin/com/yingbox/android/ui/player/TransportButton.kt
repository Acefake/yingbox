package com.yingbox.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** 电视上获得焦点的按钮放大到这个倍数：隔着客厅的距离也要一眼看出焦点在哪 */
private const val TV_FOCUS_SCALE = 1.18f

/**
 * 控制层上的圆形图标按钮，手机和电视共用；[label] 是叠在图标中间的小字（快进快退的「10」），
 * [big] 是中间的播放暂停。电视上聚焦时放大并加白色外圈，[modifier] 可传 focusRequester 设默认焦点。
 */
@Composable
internal fun TransportButton(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    big: Boolean = false,
    label: String? = null,
    size: Dp = if (big) 56.dp else 44.dp,
    onClick: () -> Unit,
) {
    val isTv = LocalIsTv.current
    var focused by remember { mutableStateOf(false) }
    val tvFocused = isTv && focused
    val scale by animateFloatAsState(if (tvFocused) TV_FOCUS_SCALE else 1f, tween(150), label = "transport-focus")
    Box(
        modifier
            .size(size)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .border(if (tvFocused) 2.dp else 0.dp, if (tvFocused) Color.White else Color.Transparent, CircleShape)
            .onFocusChanged { focused = it.hasFocus }
            .alpha(if (enabled) 1f else 0.35f)
            .then(if (big) Modifier.background(Color.White, CircleShape) else Modifier)
            .focusFrame(shape = CircleShape, onClick = { if (enabled) onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = if (big) Color.Black else YbColor.TextPrimary, modifier = Modifier.size(if (big) 30.dp else 26.dp))
        if (label != null) Text(label, color = YbColor.TextPrimary, fontSize = YbText.Xs2, fontWeight = FontWeight.Bold)
    }
}
