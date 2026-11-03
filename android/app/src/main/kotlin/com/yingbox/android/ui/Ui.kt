package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 页面共用的颜色、形状与焦点样式（电视遥控器焦点是第一优先，ADR-0028） */
internal val Muted = Color(0xFF8E8E93)
internal val Subtle = Color(0xFFD1D1D6)
internal val Surface = Color(0xFF1C1C1E)
internal val CardShape = RoundedCornerShape(8.dp)

@Composable
internal fun RowTitle(text: String) {
    Text(text, color = Color.White, fontSize = 22.sp)
}

/** 整页提示：加载中、失败 */
@Composable
internal fun Message(text: String) {
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Text(text, color = Muted, fontSize = 16.sp)
    }
}

/** 可聚焦（遥控器方向键能走到）、可点；聚焦时白框，selected 时灰底 */
@Composable
internal fun Modifier.focusFrame(selected: Boolean = false, onClick: () -> Unit = {}): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    return this
        .clip(CardShape)
        .then(if (selected) Modifier.background(Color(0xFF3A3A3C), CardShape) else Modifier)
        .border(if (focused) 3.dp else 0.dp, if (focused) Color.White else Color.Transparent, CardShape)
        .clickable(interactionSource = interaction, indication = null, onClick = onClick)
}
