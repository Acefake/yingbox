package com.yingbox.android.server

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.yingbox.android.R

/** 前台服务：持有内嵌 node 进程，应用退到后台时扫描、刮削不被系统停掉（ADR-0028）。 */
class ServerService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.server_channel), NotificationManager.IMPORTANCE_MIN),
            )
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(getString(R.string.server_running))
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    /**
     * 每次打开界面都会走到这里：服务停在失败状态时，重新打开应用就再试一轮。
     * 不用 START_STICKY：应用进程被杀时 node 跟着没了，系统重建出的服务没有界面持有，没人会停它。
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        LocalServer.start(this)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        LocalServer.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "server"
        private const val NOTIFICATION_ID = 1

        /** 最后一个界面离开后再等这么久才停服务，期间回来就不停。 */
        private const val STOP_DELAY_MS = 5_000L

        private val main = Handler(Looper.getMainLooper())
        private var holders = 0
        private var pendingStop: Runnable? = null

        /**
         * 界面 onCreate 时调用。和 [release] 成对、只在主线程调用。
         * 不在 onDestroy 里直接停：结束的旧 Activity 的 onDestroy 晚于新 Activity 的 onCreate，
         * 旋转屏幕则相反，计数加延迟停止让两种顺序都不会误停或白白重启。
         */
        fun acquire(context: Context) {
            holders++
            pendingStop?.let(main::removeCallbacks)
            pendingStop = null
            ContextCompat.startForegroundService(context, Intent(context, ServerService::class.java))
        }

        fun release(context: Context) {
            holders--
            if (holders > 0) return
            val app = context.applicationContext
            pendingStop = Runnable {
                pendingStop = null
                app.stopService(Intent(app, ServerService::class.java))
            }.also { main.postDelayed(it, STOP_DELAY_MS) }
        }
    }
}
