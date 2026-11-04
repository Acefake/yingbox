package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.view.ProbeStatus
import com.yingbox.android.view.SourceKind
import com.yingbox.android.view.ViewSourceSite

/**
 * 一个播放源的卡片，样式与桌面源列表一致：状态点 + 站点名 + 分辨率规格标签 + 延迟 · 速度，
 * 最快的标「最快」，测速失败的灰掉；选中用 --bg-active 填底，不加边框。
 */
@Composable
internal fun SourceCard(site: ViewSourceSite, selected: Boolean, onClick: () -> Unit) {
    val failed = site.status == ProbeStatus.FAIL
    Row(
        Modifier
            .width(minOf(252.dp, LocalConfiguration.current.screenWidthDp.dp - gutter() * 2))
            .alpha(if (failed) 0.55f else 1f)
            .background(YbColor.Elevated, YbRadius.Lg)
            .tvFocusViewport()
            .focusFrame(shape = YbRadius.Lg, selected = selected, onClick = onClick)
            .padding(horizontal = YbSpace.S3, vertical = YbSpace.S3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
    ) {
        Spacer(
            Modifier.size(8.dp).background(
                when (site.status) {
                    ProbeStatus.OK -> YbColor.Success
                    ProbeStatus.PENDING -> YbColor.Warning
                    ProbeStatus.FAIL -> YbColor.TextTertiary
                },
                CircleShape,
            ),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
            Text(
                site.siteName + if (site.kind == SourceKind.CATSPIDER) " · 插件" else "",
                color = if (failed) YbColor.TextTertiary else YbColor.TextPrimary,
                fontSize = YbText.Sm,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
                if (site.resolution.isNotEmpty()) SpecBadge(site.resolution)
                Text(site.detail, color = YbColor.TextSecondary, fontSize = YbText.Xs2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (site.fastest) {
            Text(
                "最快",
                color = YbColor.Accent,
                fontSize = YbText.Xs2,
                modifier = Modifier.background(YbColor.AccentSoft, YbRadius.Full).padding(horizontal = YbSpace.S2),
            )
        }
    }
}

/** 规格标签（4K、1080P）：浅灰实心小方块（桌面 UiSpecBadge 的 solid 样式） */
@Composable
private fun SpecBadge(text: String) {
    Text(
        text,
        color = YbColor.ActionText,
        fontSize = YbText.Xs2,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.background(YbColor.SpecSolid, YbRadius.Xs).padding(horizontal = YbSpace.S1),
    )
}
