package com.yingbox.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration

/** 根据可用窗口与输入设备选择布局；电视不会因为窗口窄而进入手机模式。 */
internal enum class AdaptiveLayout { Phone, Tablet, Tv }

internal fun adaptiveLayout(widthDp: Int, heightDp: Int, isTv: Boolean): AdaptiveLayout = when {
    isTv -> AdaptiveLayout.Tv
    widthDp < 600 || (widthDp < 960 && heightDp <= 480) -> AdaptiveLayout.Phone
    else -> AdaptiveLayout.Tablet
}

@Composable
internal fun currentLayout(): AdaptiveLayout {
    val config = LocalConfiguration.current
    return adaptiveLayout(config.screenWidthDp, config.screenHeightDp, LocalIsTv.current)
}
