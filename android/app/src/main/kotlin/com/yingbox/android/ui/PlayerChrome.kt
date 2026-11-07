package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * 增强对比：按住显示原画（擦除线向左扫过），松开恢复增强画面。
 * 触屏按住手指，遥控器按住确定键；按住期间控制层不自动隐藏。
 */
@Composable
internal fun CompareButton(state: PlayerState, onActivity: () -> Unit, onHold: (Boolean) -> Unit) {
    DisposableEffect(state) {
        onDispose { state.compareEnhance(false); onHold(false) }
    }
    val comparing = state.enhanceComparing
    fun hold(on: Boolean) {
        state.compareEnhance(on)
        onHold(on)
        onActivity()
    }
    Box(
        Modifier
            .size(40.dp)
            .onPreviewKeyEvent { event ->
                val center = event.key == Key.DirectionCenter || event.key == Key.Enter || event.key == Key.NumPadEnter
                when {
                    !center -> false
                    event.type == KeyEventType.KeyDown -> { if (event.nativeKeyEvent.repeatCount == 0) hold(true); true }
                    event.type == KeyEventType.KeyUp -> { hold(false); true }
                    else -> false
                }
            }
            .then(if (comparing) Modifier.background(Color(0x33FFFFFF), CircleShape) else Modifier)
            .focusFrame(shape = CircleShape)
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    hold(true)
                    tryAwaitRelease()
                    hold(false)
                })
            }
            .semantics { contentDescription = "按住对比原画" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(PlayerIcons.Compare, contentDescription = null, tint = YbColor.TextPrimary, modifier = Modifier.size(24.dp))
    }
}
