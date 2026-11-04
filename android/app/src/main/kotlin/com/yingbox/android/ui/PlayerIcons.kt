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
    val Compare: ImageVector by lazy { icon("Compare", "M3,4H21V20H3ZM13,6V18H19V6Z") }
    val Enhance: ImageVector by lazy { icon("Enhance", "M12,2L15,9L22,12L15,15L12,22L9,15L2,12L9,9Z") }
    val Pause: ImageVector by lazy { icon("Pause", "M6,19h4V5H6v14zm8,-14v14h4V5h-4z") }
    val Fullscreen: ImageVector by lazy {
        icon("Fullscreen", "M7,14H5v5h5v-2H7v-3zM5,10h2V7h3V5H5v5zM17,17h-3v2h5v-5h-2v3zM14,5v2h3v3h2V5h-5z")
    }
    val FullscreenExit: ImageVector by lazy {
        icon("FullscreenExit", "M5,16h3v3h2v-5H5v2zM8,8H5v2h5V5H8v3zM14,19h2v-3h3v-2h-5v5zM16,8V5h-2v5h5V8h-3z")
    }
    val SkipNext: ImageVector by lazy { icon("SkipNext", "M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z") }
    val SkipPrevious: ImageVector by lazy { icon("SkipPrevious", "M6,6h2v12H6zm3.5,6l8.5,6V6z") }

    /** 快退 10 秒：向左的回转箭头，「10」画在图形里（Material replay_10） */
    val Replay10: ImageVector by lazy {
        icon("Replay10", "M11.99,5V1l-5,5l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6s-6,-2.69 -6,-6h-2c0,4.42 3.58,8 8,8s8,-3.58 8,-8S16.41,5 11.99,5zM10.89,16h-0.85v-3.26l-1.01,0.31v-0.69l1.79,-0.63h0.07V16zM15.17,14.24c0,0.32 -0.03,0.6 -0.1,0.82s-0.17,0.42 -0.29,0.57s-0.28,0.26 -0.45,0.33s-0.37,0.1 -0.59,0.1s-0.41,-0.03 -0.59,-0.1s-0.33,-0.18 -0.46,-0.33s-0.23,-0.34 -0.3,-0.57s-0.11,-0.5 -0.11,-0.82v-0.74c0,-0.32 0.03,-0.6 0.1,-0.82s0.17,-0.42 0.29,-0.57s0.28,-0.26 0.45,-0.33s0.37,-0.1 0.59,-0.1s0.41,0.03 0.59,0.1c0.18,0.07 0.33,0.18 0.46,0.33s0.23,0.34 0.3,0.57s0.11,0.5 0.11,0.82V14.24zM14.32,13.38c0,-0.19 -0.01,-0.35 -0.04,-0.48s-0.07,-0.23 -0.12,-0.31s-0.11,-0.14 -0.19,-0.17s-0.16,-0.05 -0.25,-0.05s-0.18,0.02 -0.25,0.05s-0.14,0.09 -0.19,0.17s-0.09,0.18 -0.12,0.31s-0.04,0.29 -0.04,0.48v0.97c0,0.19 0.01,0.35 0.04,0.48s0.07,0.24 0.12,0.32s0.11,0.14 0.19,0.17s0.16,0.05 0.25,0.05s0.18,-0.02 0.25,-0.05s0.14,-0.09 0.19,-0.17s0.09,-0.19 0.11,-0.32c0.02,-0.13 0.03,-0.29 0.03,-0.48V13.38z")
    }

    /** 快进 10 秒：向右的回转箭头，「10」画在图形里（Material forward_10） */
    val Forward10: ImageVector by lazy {
        icon("Forward10", "M18,13c0,3.31 -2.69,6 -6,6s-6,-2.69 -6,-6s2.69,-6 6,-6v4l5,-5l-5,-5v4c-4.42,0 -8,3.58 -8,8c0,4.42 3.58,8 8,8s8,-3.58 8,-8H18zM10.86,15.94v-4.27h-0.09L9,12.3v0.69l1.01,-0.31v3.26H10.86zM15.17,14.24v-0.74c0,-0.32 -0.04,-0.6 -0.11,-0.82s-0.17,-0.42 -0.3,-0.57s-0.28,-0.26 -0.46,-0.33s-0.37,-0.1 -0.59,-0.1s-0.41,0.03 -0.59,0.1s-0.33,0.18 -0.45,0.33s-0.22,0.34 -0.29,0.57s-0.1,0.5 -0.1,0.82v0.74c0,0.32 0.04,0.6 0.11,0.82s0.17,0.42 0.3,0.57s0.28,0.26 0.46,0.33s0.37,0.1 0.59,0.1s0.41,-0.03 0.59,-0.1s0.33,-0.18 0.45,-0.33s0.22,-0.34 0.29,-0.57S15.17,14.56 15.17,14.24zM14.31,13.38v0.97c0,0.19 -0.01,0.35 -0.04,0.48s-0.07,0.23 -0.12,0.31s-0.11,0.14 -0.19,0.17s-0.16,0.05 -0.25,0.05s-0.18,-0.02 -0.25,-0.05s-0.14,-0.09 -0.19,-0.17s-0.09,-0.18 -0.12,-0.31s-0.04,-0.29 -0.04,-0.48v-0.97c0,-0.19 0.01,-0.35 0.04,-0.48s0.07,-0.23 0.12,-0.31s0.11,-0.14 0.19,-0.17s0.16,-0.05 0.25,-0.05s0.18,0.02 0.25,0.05s0.14,0.09 0.19,0.17s0.09,0.18 0.12,0.31S14.31,13.19 14.31,13.38z")
    }
}

private fun icon(name: String, d: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        .addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
        .build()
