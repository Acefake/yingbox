package com.yingbox.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.hardware.display.DisplayManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRouter
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import com.yingbox.android.playback.engine.playbackDiagnosticReport

/** 监听播放画面所在的显示器与音频路由，离开画面时注销，不持有 Activity 全局缓存。 */
@Composable
internal fun ObservePlaybackCapabilities(state: PlayerState) {
    val context = LocalContext.current
    val view = LocalView.current
    DisposableEffect(state, context, view) {
        val displays = context.getSystemService(DisplayManager::class.java)
        val audio = context.getSystemService(AudioManager::class.java)
        val router = context.getSystemService(MediaRouter::class.java)
        val handler = Handler(Looper.getMainLooper())
        fun refresh() = state.refreshCapabilities(context, view.display?.displayId ?: Display.DEFAULT_DISPLAY)
        val displayListener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) { refresh() }
            override fun onDisplayRemoved(displayId: Int) { refresh() }
            override fun onDisplayChanged(displayId: Int) { refresh() }
        }
        val audioListener = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) { refresh() }
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) { refresh() }
        }
        val routeListener = object : MediaRouter.SimpleCallback() {
            override fun onRouteSelected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) { refresh() }
            override fun onRouteUnselected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) { refresh() }
            override fun onRouteChanged(router: MediaRouter, info: MediaRouter.RouteInfo) { refresh() }
        }
        displays?.registerDisplayListener(displayListener, handler)
        audio?.registerAudioDeviceCallback(audioListener, handler)
        router?.addCallback(MediaRouter.ROUTE_TYPE_LIVE_AUDIO, routeListener, MediaRouter.CALLBACK_FLAG_UNFILTERED_EVENTS)
        refresh()
        onDispose {
            displays?.unregisterDisplayListener(displayListener)
            audio?.unregisterAudioDeviceCallback(audioListener)
            router?.removeCallback(routeListener)
            handler.removeCallbacksAndMessages(null)
        }
    }
}

/** 复制只包含格式、能力与采样统计的报告，不附带媒体地址和标题。 */
internal fun copyPlaybackDiagnostics(context: Context, state: PlayerState) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    state.refreshCapabilities(context)
    val report = playbackDiagnosticReport(state.stats.snapshot, state.capabilities, state.videoPlan)
    clipboard.setPrimaryClip(ClipData.newPlainText("影盒播放诊断", report))
    Toast.makeText(context, "播放诊断已复制", Toast.LENGTH_SHORT).show()
}
