package com.yingbox.android.update

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewAppUpdate
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 设置页和更新提示共用的状态。 */
sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val update: ViewAppUpdate) : UpdateState
    data class Downloading(val update: ViewAppUpdate, val progress: Float) : UpdateState
    data class Installing(val update: ViewAppUpdate, val needsPermission: Boolean) : UpdateState
    data class Failed(val message: String, val update: ViewAppUpdate?) : UpdateState
}

/** 每次最多一个检查或下载；后台失败不打扰，设置页支持手动检查和重试安装。 */
class UpdateController(context: Context, client: ServerClient, private val scope: CoroutineScope) {
    private val updater = AppUpdater(context, client)
    private val prefs = context.getSharedPreferences("update", Context.MODE_PRIVATE)
    private var task: Job? = null
    private var downloaded: Pair<ViewAppUpdate, File>? = null
    val currentVersion: String get() = updater.currentVersion
    var state by mutableStateOf<UpdateState>(UpdateState.Idle)
        private set
    var promptOpen by mutableStateOf(false)
        private set

    fun dismiss() { promptOpen = false }

    /** 成功检查后六小时内不再自动查询；检查失败在下次启动重试。 */
    fun checkOnLaunch() {
        if (System.currentTimeMillis() - prefs.getLong("lastCheck", 0L) >= 6L * 60 * 60 * 1000) check(silent = true)
    }

    fun check(silent: Boolean = false) {
        if (task?.isActive == true) return
        state = UpdateState.Checking
        task = scope.launch {
            try {
                val update = withContext(Dispatchers.IO) { updater.check() }
                prefs.edit().putLong("lastCheck", System.currentTimeMillis()).apply()
                state = if (update != null) UpdateState.Available(update) else if (silent) UpdateState.Idle else UpdateState.UpToDate
                if (silent && update != null) promptOpen = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state = if (silent) UpdateState.Idle else UpdateState.Failed("检查更新失败：${e.message}", null)
            }
        }
    }

    /** 授权返回和取消安装均复用已下载的包，避免重复下载。 */
    fun startUpdate() {
        if (task?.isActive == true) return
        val update = when (val value = state) {
            is UpdateState.Available -> value.update
            is UpdateState.Failed -> value.update
            is UpdateState.Installing -> value.update
            else -> null
        } ?: return
        promptOpen = true
        state = UpdateState.Downloading(update, 0f)
        task = scope.launch {
            try {
                val apk = downloaded?.takeIf { it.first == update && it.second.isFile }?.second
                    ?: withContext(Dispatchers.IO) {
                        updater.download(update) { progress ->
                            withContext(Dispatchers.Main) { state = UpdateState.Downloading(update, progress) }
                        }
                    }.also { downloaded = update to it }
                val result = updater.install(apk, update.version)
                state = UpdateState.Installing(update, result == InstallResult.NeedsPermission)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state = UpdateState.Failed(e.message ?: "更新失败", update)
            }
        }
    }
}
