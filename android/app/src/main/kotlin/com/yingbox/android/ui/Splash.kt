package com.yingbox.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp

/** 区间内的入场进度，限制在 0..1。 */
private fun segment(total: Float, from: Float, to: Float): Float =
    FastOutSlowInEasing.transform(((total - from) / (to - from)).coerceIn(0f, 1f))

/** 与桌面同源的六色玻璃标志，启动时轻微悬浮并扫过高光。 */
@Composable
private fun AnimatedLogo(intro: Float, loop: Float, modifier: Modifier) {
    Image(
        painter = painterResource(LocalBrandColor.current.icon),
        contentDescription = null,
        modifier = modifier.graphicsLayer {
            alpha = intro
            scaleX = 0.94f + 0.06f * intro
            scaleY = scaleX
            translationY = if (intro >= 1f) (-2f * kotlin.math.sin(loop * 2f * Math.PI.toFloat())).dp.toPx() else 0f
            clip = true
            shape = androidx.compose.foundation.shape.RoundedCornerShape(22)
        }.drawWithContent {
            drawContent()
            if (intro >= 1f && loop > 0f && loop < 0.65f) {
                val x = size.width * (-1f + loop * 4f)
                drawRect(Brush.linearGradient(
                    listOf(Color.Transparent, Color.White.copy(alpha = 0.12f), Color.Transparent),
                    Offset(x, 0f), Offset(x + size.width * 0.3f, size.height),
                ))
            }
        },
    )
}

/** 首页等常驻位置使用静态标志。 */
@Composable
fun LogoMark(modifier: Modifier = Modifier) {
    AnimatedLogo(intro = 1f, loop = 0f, modifier = modifier)
}

/** 入场动画时长；启动页至少显示这么久，动画才不会被快速就绪的服务切断 */
const val SPLASH_INTRO_MS = 1500

/**
 * 启动页：动态 logo + 应用名 + 当前状态（服务启动中 / 失败原因）。服务就绪后由 App 切到首页。
 */
@Composable
fun LogoSplash(status: String, details: List<String> = emptyList(), failed: Boolean = false, playIntro: Boolean = true) {
    val intro = remember { Animatable(if (playIntro) 0f else 1f) }
    LaunchedEffect(Unit) { if (playIntro) intro.animateTo(1f, tween(SPLASH_INTRO_MS, easing = LinearEasing)) }
    val loop = rememberInfiniteTransition(label = "logo-loop").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(5600, easing = LinearEasing), RepeatMode.Restart),
        label = "logo-sheen",
    )
    val logoSize = if (LocalConfiguration.current.screenWidthDp >= 600) 176.dp else 132.dp
    // 文字跟随品牌标志入场
    val textAlpha = segment(intro.value, 0.6f, 1f)
    Column(
        modifier = Modifier.fillMaxSize().background(YbColor.Base).padding(YbSpace.S9),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AnimatedLogo(intro.value, loop.value, Modifier.size(logoSize))
        BrandWordmark(Modifier.padding(top = YbSpace.S6).width(112.dp).height(52.dp).alpha(textAlpha))
        Text(
            status,
            color = if (failed) YbColor.TextPrimary else YbColor.TextSecondary,
            fontSize = YbText.Sm,
            modifier = Modifier.padding(top = YbSpace.S3).alpha(textAlpha),
        )
        for (line in details) Text(line, color = YbColor.TextTertiary, fontSize = YbText.Xs2)
    }
}

/** 与图标同色的专用中文品牌字标。 */
@Composable
fun BrandWordmark(modifier: Modifier = Modifier) {
    Image(painterResource(LocalBrandColor.current.wordmark), contentDescription = "影盒", modifier = modifier)
}
