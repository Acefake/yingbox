package com.yingbox.android.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** 图片清晰度档位（设置值沿用桌面 `scrape.imageSize.*`：w342 标准 / w780 高清 / original 原图） */
enum class ImageQuality(val value: String, val label: String) {
    STANDARD("w342", "标准"),
    HIGH("w780", "高清"),
    ORIGINAL("original", "原图"),
    ;

    companion object {
        fun of(value: String?): ImageQuality = entries.firstOrNull { it.value == value } ?: HIGH
    }
}

/** 三类图片，各对应一个桌面设置键 */
enum class ImageKind(val key: String, val label: String, val baseWidth: Int) {
    POSTER("scrape.imageSize.poster", "海报", 480),
    BACKDROP("scrape.imageSize.backdrop", "背景图", 780),
    ACTOR("scrape.imageSize.actor", "演员头像", 300),
}

/**
 * 图片清晰度：服务端的缩略图只有 300 / 480 / 780 三档（/media/thumb?w=）。视图里每类图有一个默认档
 * （头像 300、海报与剧照 480、背景 780），「高清」就是默认；「标准」降一档，「原图」升一档。
 * 状态是 Compose 状态，在设置页改了，已显示的图下次组合时就换档。
 */
object ImageQualities {
    private val widths = listOf(300, 480, 780)
    var poster by mutableStateOf(ImageQuality.HIGH)
    var backdrop by mutableStateOf(ImageQuality.HIGH)
    var actor by mutableStateOf(ImageQuality.HIGH)

    fun get(kind: ImageKind): ImageQuality = when (kind) {
        ImageKind.POSTER -> poster
        ImageKind.BACKDROP -> backdrop
        ImageKind.ACTOR -> actor
    }

    fun set(kind: ImageKind, quality: ImageQuality) {
        when (kind) {
            ImageKind.POSTER -> poster = quality
            ImageKind.BACKDROP -> backdrop = quality
            ImageKind.ACTOR -> actor = quality
        }
    }

    /** 缩略图路径换成按设置的档：路径里的 w= 是视图给的默认档，靠它判断是哪类图；别的路径原样返回 */
    fun rewrite(path: String): String {
        if (!path.startsWith("/media/thumb?w=")) return path
        val width = path.substring("/media/thumb?w=".length).takeWhile { it.isDigit() }.toIntOrNull() ?: return path
        val kind = ImageKind.entries.firstOrNull { it.baseWidth == width } ?: return path
        val shift = when (get(kind)) {
            ImageQuality.STANDARD -> -1
            ImageQuality.HIGH -> 0
            ImageQuality.ORIGINAL -> 1
        }
        val target = widths[(widths.indexOf(width) + shift).coerceIn(0, widths.lastIndex)]
        return if (target == width) path else "/media/thumb?w=$target" + path.substring("/media/thumb?w=$width".length)
    }
}
