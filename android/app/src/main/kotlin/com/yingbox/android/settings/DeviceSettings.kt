package com.yingbox.android.settings

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * 只跟这台设备有关的设置（ADR-0033）：存在应用自己的 SharedPreferences，不进服务端。
 * 值是 Compose 状态，界面直接读，改了立即重组。
 */
class DeviceSettings(context: Context) {
    private val prefs = context.getSharedPreferences("device-settings", Context.MODE_PRIVATE)

    /** 降低透明度：浮动控件的玻璃用实色，不做背景模糊（低配设备、电视更流畅） */
    var reduceTransparency by mutableStateOf(prefs.getBoolean(REDUCE_TRANSPARENCY, false))
        private set

    /** 剧集播完自动播放下一集；关闭时播完回到详情页 */
    var autoNext by mutableStateOf(prefs.getBoolean(AUTO_NEXT, true))
        private set

    fun updateReduceTransparency(on: Boolean) {
        reduceTransparency = on
        prefs.edit().putBoolean(REDUCE_TRANSPARENCY, on).apply()
    }

    fun updateAutoNext(on: Boolean) {
        autoNext = on
        prefs.edit().putBoolean(AUTO_NEXT, on).apply()
    }

    private companion object {
        const val REDUCE_TRANSPARENCY = "ui.reduceTransparency"
        const val AUTO_NEXT = "player.autoNext"
    }
}
