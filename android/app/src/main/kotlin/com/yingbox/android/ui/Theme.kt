package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect

/**
 * 影盒界面令牌（与桌面 src/renderer/src/assets/styles/tokens.css 的深色主题一致）。
 * 深色优先：纯黑底，层次靠明度不靠线；颜色交给海报；强调蓝只用于焦点。
 */
object YbColor {
    val Base = Color(0xFF000000)
    val Sidebar = Color(0xFF0E0E10)
    /** 卡片、浮层 */
    val Elevated = Color(0xFF1C1C1E)
    /** 次级控件 */
    val FillSecondary = Color(0xFF2C2C2E)
    /** 选中态填底（不加边框） */
    val Active = Color(0x1FFFFFFF)
    val TextPrimary = Color(0xFFFFFFFF)
    val TextSecondary = Color(0xA3FFFFFF)
    val TextTertiary = Color(0x80FFFFFF)
    val Accent = Color(0xFF0A84FF)
    /** 焦点环（--focus-ring 的 --accent-glow） */
    val AccentGlow = Color(0x660A84FF)
    /** 主按钮：深色下白底黑字 */
    /** 评分星（--rating） */
    val Rating = Color(0xFFFFD60A)
    /** 豆瓣评分来源标识，与桌面 UiRatingBadge 一致。 */
    val Douban = Color(0xFF2E963D)
    /** 测速成功的状态点（--success） */
    val Success = Color(0xFF30D158)
    /** 测速中的状态点（--warning） */
    val Warning = Color(0xFFFF9F0A)
    /** 强调色的浅底（--accent-soft），「最快」标签用 */
    val AccentSoft = Color(0x330A84FF)
    /** 规格标签的浅灰实心底（UiSpecBadge solid） */
    val SpecSolid = Color(0xFFD1D1D6)
    val ActionBg = Color(0xFFF5F5F7)
    val ActionText = Color(0xFF111113)
    /** 玻璃底色（--glass-bg） */
    val GlassBg = Color(0x61242428)
    /** 拿不到背景模糊时（视频画面上）的玻璃：更实的深色 */
    val GlassFallback = Color(0xB8242428)
    val GlassEdgeTop = Color(0x4DFFFFFF)
    val GlassEdgeBottom = Color(0x1AFFFFFF)
}

/** 字号档（--text-*） */
object YbText {
    val Xs2 = 11.sp
    val Xs = 12.sp
    val Sm = 13.sp
    val Md = 14.sp
    val Lg = 17.sp
    val Xl = 22.sp
    val Xl2 = 28.sp
    val Xl3 = 34.sp
}

/** 圆角档（--radius-*） */
object YbRadius {
    val Xs = RoundedCornerShape(4.dp)
    val Sm = RoundedCornerShape(6.dp)
    val Md = RoundedCornerShape(10.dp)
    val Lg = RoundedCornerShape(14.dp)
    /** 海报卡、剧照横卡 */
    val Card = RoundedCornerShape(18.dp)
    val Xl = RoundedCornerShape(20.dp)
    val Xl2 = RoundedCornerShape(28.dp)
    val Full = RoundedCornerShape(50)
}

/** 间距档（--space-*） */
object YbSpace {
    val S1 = 4.dp
    val S2 = 8.dp
    val S3 = 12.dp
    val S4 = 16.dp
    val S5 = 20.dp
    val S6 = 24.dp
    val S7 = 32.dp
    val S8 = 40.dp
    val S9 = 48.dp
    val S10 = 64.dp
}

/** 页面内容的模糊来源（App 根部的 hazeSource）；没有时玻璃退成更实的深色 */
/** 设置「降低透明度」：玻璃改实色、不做模糊 */
val LocalReduceTransparency = compositionLocalOf { false }

/** 当前设备是否使用电视遥控器交互。 */
val LocalIsTv = compositionLocalOf { false }

/** 浮动导航或返回按钮占用的纵向区域。 */
internal val LocalTvFocusTopInset = compositionLocalOf { 0.dp }

/** 电视焦点仅在超出视口时带动滚动，不强制挪到屏幕中部。 */
internal val TvBringIntoViewSpec = object : BringIntoViewSpec {}

val LocalHaze = compositionLocalOf<HazeState?> { null }

/**
 * 玻璃材质（.yb-glass，只给浮动控件：导航、圆钮、胶囊、浮层）：背景模糊 + 轻底色 +
 * 上亮下暗的 0.5dp 发丝边 + 投影。media 为压在视频画面上的版本：视频是 SurfaceView，拿不到模糊，用更实的深色。
 * 内容卡片一律实色，不要用它。
 */
@Composable
fun Modifier.ybGlass(shape: Shape, media: Boolean = false): Modifier {
    val reduce = LocalReduceTransparency.current
    val haze = if (media || reduce) null else LocalHaze.current
    return this
        .shadow(10.dp, shape, ambientColor = Color(0x59000000), spotColor = Color(0x59000000))
        .clip(shape)
        .then(
            if (haze != null) {
                Modifier.hazeEffect(haze) {
                    blurRadius = 24.dp
                    backgroundColor = YbColor.Base
                    tints = listOf(HazeTint(YbColor.GlassBg))
                    noiseFactor = 0f
                }
            } else {
                Modifier.background(if (reduce) YbColor.Elevated else YbColor.GlassFallback)
            },
        )
        .border(0.5.dp, Brush.verticalGradient(listOf(YbColor.GlassEdgeTop, YbColor.GlassEdgeBottom)), shape)
}

/** 玻璃圆钮：图标按钮必须带 label（读屏用） */
@Composable
fun GlassIconButton(icon: ImageVector, label: String, media: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .ybGlass(CircleShape, media)
            .focusFrame(shape = CircleShape, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = YbColor.TextPrimary, modifier = Modifier.size(20.dp))
    }
}
