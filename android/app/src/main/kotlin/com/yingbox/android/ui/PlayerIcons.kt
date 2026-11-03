package com.yingbox.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * 播放控制用的图标（Material Symbols 的基础图形，Apache 2.0，24 视框）。
 * 播放用 [YbIcons.Play]、设置用 [YbIcons.Settings]（Phosphor，生成文件）；这里只补它们没有的。
 */
internal object PlayerIcons {
    val Pause: ImageVector by lazy { icon("Pause", "M6,19h4V5H6v14zm8,-14v14h4V5h-4z") }
    val Fullscreen: ImageVector by lazy {
        icon("Fullscreen", "M7,14H5v5h5v-2H7v-3zM5,10h2V7h3V5H5v5zM17,17h-3v2h5v-5h-2v3zM14,5v2h3v3h2V5h-5z")
    }
    val FullscreenExit: ImageVector by lazy {
        icon("FullscreenExit", "M5,16h3v3h2v-5H5v2zM8,8H5v2h5V5H8v3zM14,19h2v-3h3v-2h-5v5zM16,8V5h-2v5h5V8h-3z")
    }
    val SkipNext: ImageVector by lazy { icon("SkipNext", "M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z") }
    val SkipPrevious: ImageVector by lazy { icon("SkipPrevious", "M6,6h2v12H6zm3.5,6l8.5,6V6z") }

    /** 向左的回转箭头（快退），中间由调用方叠「10」 */
    val Replay: ImageVector by lazy {
        icon("Replay", "M12,5V1L7,6l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6s-6,-2.69 -6,-6H4c0,4.42 3.58,8 8,8s8,-3.58 8,-8s-3.58,-8 -8,-8z")
    }

    /** 向右的回转箭头（快进），中间由调用方叠「10」 */
    val Forward: ImageVector by lazy {
        icon("Forward", "M12,5V1l5,5l-5,5V7c-3.31,0 -6,2.69 -6,6s2.69,6 6,6s6,-2.69 6,-6h2c0,4.42 -3.58,8 -8,8s-8,-3.58 -8,-8s3.58,-8 8,-8z")
    }
}

private fun icon(name: String, d: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        .addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
        .build()
