package com.yingbox.android.ui

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yingbox.android.playback.engine.formatClock

/**
 * 盖在画面上的几条提示，顺序从下到上：手势提示（亮度、音量、快进快退、倍速）、
 * 电视隐藏态拖进度的目标时间、错误、降级与软解提示。都由 [PlayerHost] 的状态驱动，
 * 这里只负责摆放，改动提示不影响控制层与手势。
 */
@Composable
internal fun BoxScope.PlayerNotices(
    hud: String?,
    scrubTime: Long?,
    error: String?,
    notice: String?,
    noticeShown: Boolean,
) {
    hud?.let {
        Text(
            it,
            color = YbColor.TextPrimary,
            fontSize = YbText.Md,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.align(Alignment.Center).ybGlass(YbRadius.Full, media = true).padding(horizontal = YbSpace.S5, vertical = YbSpace.S3),
        )
    }
    scrubTime?.let { ScrubTime(it, Modifier.align(Alignment.Center)) }
    error?.let {
        Text(
            it,
            color = YbColor.TextPrimary,
            fontSize = YbText.Md,
            modifier = Modifier.align(Alignment.Center).ybGlass(YbRadius.Lg, media = true).padding(YbSpace.S4),
        )
    }
    if (noticeShown) {
        notice?.let {
            Text(
                it,
                color = YbColor.TextPrimary,
                fontSize = YbText.Md,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(YbSpace.S4)
                    // 放在顶栏（标题和图标）下面一点
                    .padding(top = 72.dp)
                    .ybGlass(YbRadius.Lg, media = true)
                    .padding(YbSpace.S4),
            )
        }
    }
}
