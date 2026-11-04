package com.yingbox.android.settings

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.yingbox.android.library.NasConfig
import com.yingbox.android.playback.engine.EnhanceLevel

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

    /** 播放出错或卡住时自动换到别的站点（桌面同名设置 online.autoSwitchSource） */
    var autoSwitchSource by mutableStateOf(prefs.getBoolean(AUTO_SWITCH, true))
        private set

    /** 画质增强档位（FSR 放大 + 锐化，仅 SDR）；下一次轨道变化（换集、换源）时生效 */
    var enhanceLevel by mutableStateOf(EnhanceLevel.fromKey(prefs.getString(ENHANCE, null)))
        private set

    fun updateEnhanceLevel(level: EnhanceLevel) {
        enhanceLevel = level
        prefs.edit().putString(ENHANCE, level.key).apply()
    }

    /** NAS 上的影盒服务（ADR-0040）；没配置为 null。令牌只存在应用私有目录（不备份） */
    var nas by mutableStateOf(loadNas())
        private set

    fun updateNas(config: NasConfig) {
        nas = config
        prefs.edit().putString(NAS_URL, config.url).putString(NAS_TOKEN, config.token).apply()
    }

    fun clearNas() {
        nas = null
        prefs.edit().remove(NAS_URL).remove(NAS_TOKEN).apply()
    }

    private fun loadNas(): NasConfig? =
        prefs.getString(NAS_URL, null)?.let { NasConfig(it, prefs.getString(NAS_TOKEN, "") ?: "") }

    fun updateAutoSwitchSource(on: Boolean) {
        autoSwitchSource = on
        prefs.edit().putBoolean(AUTO_SWITCH, on).apply()
    }

    fun updateReduceTransparency(on: Boolean) {
        reduceTransparency = on
        prefs.edit().putBoolean(REDUCE_TRANSPARENCY, on).apply()
    }

    fun updateAutoNext(on: Boolean) {
        autoNext = on
        prefs.edit().putBoolean(AUTO_NEXT, on).apply()
    }

    companion object {
        /** 播放器在轨道变化时读取，不依赖设置界面的状态对象 */
        fun readEnhanceLevel(context: Context): EnhanceLevel =
            EnhanceLevel.fromKey(
                context.getSharedPreferences("device-settings", Context.MODE_PRIVATE).getString(ENHANCE, null),
            )

        private const val ENHANCE = "player.enhance"
        private const val REDUCE_TRANSPARENCY = "ui.reduceTransparency"
        const val AUTO_NEXT = "player.autoNext"
        const val AUTO_SWITCH = "online.autoSwitchSource"
        const val NAS_URL = "nas.url"
        const val NAS_TOKEN = "nas.token"
    }
}
