package com.yingbox.android.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** 设置页的底板：一页一张实色卡片，里面的分组（[SettingsGroup]）之间用 [SettingsDivider] 分节 */
@Composable
internal fun SettingsCard(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(YbColor.Elevated, YbRadius.Card).padding(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
    ) { content() }
}

/** 底板里两个分组之间的细线 */
@Composable
internal fun SettingsDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(YbColor.TextTertiary.copy(alpha = 0.2f)))
}

/** 设置分组（放在 [SettingsCard] 里）：小标题 + 一行行设置，末尾可跟补充说明 */
@Composable
internal fun SettingsGroup(title: String, footer: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
        Text(title, color = YbColor.TextSecondary, fontSize = YbText.Sm, fontWeight = FontWeight.Medium)
        Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S5)) { content() }
        if (footer != null) {
            Text(footer, color = YbColor.TextTertiary, fontSize = YbText.Xs)
        }
    }
}

/** 一行设置：左边标题和说明，右边是控件（开关等） */
@Composable
internal fun SettingsRow(title: String, description: String? = null, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth().tvFocusViewport(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S4)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
            Text(title, color = YbColor.TextPrimary, fontSize = if (LocalIsTv.current) YbText.Lg else YbText.Md, fontWeight = FontWeight.Medium)
            if (description != null) Text(description, color = YbColor.TextSecondary, fontSize = if (LocalIsTv.current) YbText.Md else YbText.Xs)
        }
        trailing()
    }
}

/** 开关：开时强调蓝底，关时次级灰底；可聚焦（遥控器确定键切换） */
@Composable
internal fun YbSwitch(checked: Boolean, label: String, onChange: (Boolean) -> Unit) {
    val knob by animateDpAsState(if (checked) 22.dp else 2.dp, tween(150), label = "switch-knob")
    Box(
        Modifier
            .size(width = 64.dp, height = 48.dp)
            .focusFrame(shape = CircleShape) { onChange(!checked) }
            .semantics {
                role = Role.Switch
                contentDescription = label
                stateDescription = if (checked) "开" else "关"
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(width = 51.dp, height = 31.dp).background(if (checked) YbColor.Accent else YbColor.FillSecondary, CircleShape)) {
            Box(Modifier.offset(x = knob, y = 2.dp).size(27.dp).background(YbColor.TextPrimary, CircleShape))
        }
    }
}
