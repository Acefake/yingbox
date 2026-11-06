package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.util.Locale

/** 评分统一显示来源小标与数字；未知来源只显示原文字，不推断品牌。 */
@Composable
internal fun RatingBadge(rate: String, modifier: Modifier = Modifier, source: String? = null) {
    val match = Regex("^(?:(\\S+)\\s+)?(\\d+(?:\\.\\d+)?)$").matchEntire(rate.trim()) ?: return
    val value = match.groupValues[2].toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 } ?: return
    val provider = source ?: when (match.groupValues[1].lowercase()) {
        "豆瓣" -> "douban"
        "tmdb" -> "tmdb"
        else -> null
    }
    val score = String.format(Locale.ROOT, "%.1f", value)
    val label = when (provider) { "douban" -> "豆瓣 $score"; "tmdb" -> "TMDB $score"; "imdb" -> "IMDb $score"; else -> rate }
    Row(
        modifier.clearAndSetSemantics { contentDescription = label }
            .background(YbColor.GlassFallback, YbRadius.Full)
            .padding(start = YbSpace.S1, end = YbSpace.S2, top = YbSpace.S1, bottom = YbSpace.S1),
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (provider == "douban") {
            Box(Modifier.size(16.dp).background(YbColor.Douban, YbRadius.Xs), contentAlignment = Alignment.Center) {
                Text("豆", color = YbColor.TextPrimary, fontSize = YbText.Xs2, lineHeight = YbText.Xs2, fontWeight = FontWeight.SemiBold)
            }
        } else if (provider == "tmdb") {
            Box(Modifier.size(width = 30.dp, height = 16.dp).background(Brush.horizontalGradient(listOf(YbColor.TmdbStart, YbColor.TmdbEnd)), YbRadius.Xs), contentAlignment = Alignment.Center) {
                Text("TMDB", color = YbColor.TmdbText, fontSize = YbText.Xs2, fontWeight = FontWeight.SemiBold)
            }
        }
        Text(if (provider == "douban" || provider == "tmdb") score else label, color = YbColor.TextPrimary, fontSize = YbText.Xs, fontWeight = FontWeight.SemiBold)
    }
}
