package com.yingbox.android.ui

import androidx.compose.runtime.staticCompositionLocalOf
import com.yingbox.android.R

/** 当前设备的品牌配色，与桌面设置使用相同键名。 */
enum class BrandColor(val key: String, val label: String, val icon: Int, val wordmark: Int) {
    Purple("purple", "紫水晶", R.drawable.brand_icon_purple, R.drawable.brand_wordmark_purple),
    Blue("blue", "冰川蓝", R.drawable.brand_icon_blue, R.drawable.brand_wordmark_blue),
    Green("green", "翡翠绿", R.drawable.brand_icon_green, R.drawable.brand_wordmark_green),
    Gold("gold", "琥珀金", R.drawable.brand_icon_gold, R.drawable.brand_wordmark_gold),
    White("white", "珍珠白", R.drawable.brand_icon_white, R.drawable.brand_wordmark_white),
    Graphite("graphite", "烟灰", R.drawable.brand_icon_graphite, R.drawable.brand_wordmark_graphite);

    companion object {
        /** 未配置和非法配置均使用紫水晶。 */
        fun fromKey(key: String?): BrandColor = entries.firstOrNull { it.key == key } ?: Purple
    }
}

/** 所有品牌展示组件读取同一份当前设备配色。 */
val LocalBrandColor = staticCompositionLocalOf { BrandColor.Purple }
