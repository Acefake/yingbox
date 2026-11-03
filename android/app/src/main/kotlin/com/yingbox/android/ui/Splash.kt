package com.yingbox.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// 桌面端 logo（resources/icon.svg）：紫色圆角底，一个立体方块，前面白色、里面是播放三角。1024 视框。
private val BgTop = Color(0xFF8B6CFF)
private val BgBottom = Color(0xFF4527D9)
private val FaceTop = Color(0xFFE2D9FF)
private val FaceRight = Color(0xFFB9A6FF)
private val FaceFront = Color.White
private val PlayStart = Color(0xFF7A5AF8)
private val PlayEnd = Color(0xFF4527D9)

private val topFace: Path by lazy { PathParser().parsePathString("M262 382 382 262H762L642 382Z").toPath() }
private val rightFace: Path by lazy { PathParser().parsePathString("M642 382 762 262V642L642 762Z").toPath() }
private val frontFace: Path by lazy { PathParser().parsePathString("M262 382H642V762H262Z").toPath() }
private val playTriangle: Path by lazy { PathParser().parsePathString("M412 498V646L532 572Z").toPath() }

/** 一段区间内的进度（0..1），带缓动：整体进度 total 落在 [from, to] 之间时从 0 走到 1 */
private fun segment(total: Float, from: Float, to: Float): Float =
    FastOutSlowInEasing.transform(((total - from) / (to - from)).coerceIn(0f, 1f))

/**
 * 动态 logo。intro 是入场进度 0..1：前面、顶面、右面依次拼合，播放三角最后弹出；
 * loop 是入场结束后循环的 0..1：一道高光从左上扫到右下，播放三角轻轻起伏。
 */
@Composable
private fun AnimatedLogo(intro: Float, loop: Float, modifier: Modifier) {
    Canvas(modifier) {
        val k = size.width / 1024f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            val card = RoundRect(0f, 0f, 1024f, 1024f, CornerRadius(230f))
            // 底
            drawRoundRect(
                Brush.linearGradient(listOf(BgTop, BgBottom), Offset.Zero, Offset(1024f, 1024f)),
                size = Size(1024f, 1024f),
                cornerRadius = CornerRadius(230f),
            )
            drawRoundRect(
                Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.16f), Color.Transparent), 0f, 512f),
                size = Size(1024f, 1024f),
                cornerRadius = CornerRadius(230f),
            )
            // 方块：整体缩到 0.9，绕中心
            withTransform({ scale(0.9f, 0.9f, pivot = Offset(512f, 512f)) }) {
                val front = segment(intro, 0.00f, 0.40f)
                val top = segment(intro, 0.20f, 0.60f)
                val right = segment(intro, 0.35f, 0.75f)
                // 前面：从中心放大并淡入
                withTransform({ scale(0.6f + 0.4f * front, 0.6f + 0.4f * front, pivot = Offset(452f, 572f)) }) {
                    drawFace(frontFace, FaceFront, front)
                }
                // 顶面：从上方落下
                withTransform({ translate(0f, -90f * (1f - top)) }) { drawFace(topFace, FaceTop, top) }
                // 右面：从右侧滑入
                withTransform({ translate(90f * (1f - right), 0f) }) { drawFace(rightFace, FaceRight, right) }
                // 播放三角：弹出，之后随 loop 轻轻起伏
                val play = segment(intro, 0.65f, 1.00f)
                val pulse = if (intro >= 1f) 1f + 0.06f * kotlin.math.sin(loop * 2f * Math.PI.toFloat()) else 1f
                val s = play * pulse
                withTransform({ scale(s, s, pivot = Offset(484f, 572f)) }) {
                    val brush = Brush.linearGradient(listOf(PlayStart, PlayEnd), Offset(412f, 498f), Offset(532f, 646f))
                    drawPath(playTriangle, brush, alpha = play)
                    drawPath(playTriangle, brush, alpha = play, style = Stroke(40f, join = StrokeJoin.Round, cap = StrokeCap.Round))
                }
            }
            // 高光：入场结束后循环扫过，只落在圆角底范围内
            if (intro >= 1f) {
                val x = -400f + 1850f * loop
                clipPath(Path().apply { addRoundRect(card) }) {
                    drawRect(
                        Brush.linearGradient(
                            listOf(Color.Transparent, Color.White.copy(alpha = 0.22f), Color.Transparent),
                            Offset(x, 0f),
                            Offset(x + 360f, 360f),
                        ),
                    )
                }
            }
        }
    }
}

/** 静态 logo（首页左上角等）：就是动画结束后的样子 */
@Composable
fun LogoMark(modifier: Modifier = Modifier) {
    AnimatedLogo(intro = 1f, loop = 0f, modifier = modifier)
}

/** 画一个面：填充 + 同色圆角描边（桌面 logo 就是这么画的，让转角圆润） */
private fun DrawScope.drawFace(path: Path, color: Color, alpha: Float) {
    drawPath(path, color, alpha = alpha)
    drawPath(path, color, alpha = alpha, style = Stroke(48f, join = StrokeJoin.Round))
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
        animationSpec = infiniteRepeatable(tween(2600, easing = LinearEasing), RepeatMode.Restart),
        label = "logo-sheen",
    )
    val logoSize = if (LocalConfiguration.current.screenWidthDp >= 600) 176.dp else 132.dp
    // 文字在方块拼好之后淡入
    val textAlpha = segment(intro.value, 0.6f, 1f)
    Column(
        modifier = Modifier.fillMaxSize().background(YbColor.Base).padding(YbSpace.S9),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AnimatedLogo(intro.value, loop.value, Modifier.size(logoSize))
        Text(
            "影盒",
            color = YbColor.TextPrimary,
            fontSize = YbText.Xl3,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = YbSpace.S6).alpha(textAlpha),
        )
        Text(
            status,
            color = if (failed) YbColor.TextPrimary else YbColor.TextSecondary,
            fontSize = YbText.Sm,
            modifier = Modifier.padding(top = YbSpace.S3).alpha(textAlpha),
        )
        for (line in details) Text(line, color = YbColor.TextTertiary, fontSize = YbText.Xs2)
    }
}
