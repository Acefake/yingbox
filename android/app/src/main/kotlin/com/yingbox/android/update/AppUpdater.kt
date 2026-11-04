package com.yingbox.android.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewAppUpdate
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/** 系统安装器已打开，或需要用户先允许安装应用。 */
enum class InstallResult { Started, NeedsPermission }

/** 查询新版、下载并校验 APK；安装始终由系统界面向用户确认。 */
class AppUpdater(private val context: Context, client: ServerClient) {
    private val api = ViewApi(client)
    val currentVersion: String = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()

    /** 阻塞查询；调用方在 IO 线程执行。 */
    fun check(): ViewAppUpdate? = api.appUpdate(currentVersion, Build.SUPPORTED_ABIS.toList())

    /** 仅接受 HTTPS，逐跳验证重定向；调用方在 IO 线程执行。 */
    private fun openDownload(address: String): HttpURLConnection {
        var url = URL(address)
        repeat(6) {
            check(url.protocol == "https") { "更新地址必须使用 HTTPS" }
            val connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = false
            }
            try {
                val code = connection.responseCode
                if (code in listOf(301, 302, 303, 307, 308)) {
                    val location = connection.getHeaderField("Location") ?: error("更新下载重定向缺少地址")
                    url = URL(url, location)
                    connection.disconnect()
                } else {
                    check(code == 200) { "下载失败：HTTP $code" }
                    return connection
                }
            } catch (e: Exception) {
                connection.disconnect()
                throw e
            }
        }
        error("更新下载重定向次数过多")
    }

    private suspend fun downloadOne(
        address: String,
        update: ViewAppUpdate,
        target: File,
        partial: File,
        onProgress: suspend (Float) -> Unit,
    ): File {
        val connection = openDownload(address)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            var lastProgress = 0L
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        coroutineContext.ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        received += count
                        check(received <= update.size.toLong()) { "更新包超出预期大小" }
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastProgress >= 150) {
                            onProgress((received / update.size).toFloat())
                            lastProgress = now
                        }
                    }
                }
            }
            check(received == update.size.toLong()) { "下载不完整，请重试" }
            val sha256 = digest.digest().joinToString("") { "%02x".format(it) }
            check(sha256.equals(update.sha256, ignoreCase = true)) { "安装包校验失败，请重试" }
            check(partial.renameTo(target)) { "保存安装包失败" }
            onProgress(1f)
            return target
        } finally {
            connection.disconnect()
            if (partial.exists()) partial.delete()
        }
    }

    /** 下载到私有缓存，校验大小与 SHA-256；官方失败时经白名单镜像回退。 */
    suspend fun download(update: ViewAppUpdate, onProgress: suspend (Float) -> Unit): File {
        check(Regex("[0-9]+[.][0-9]+[.][0-9]+").matches(update.version)) { "更新版本格式错误" }
        check(update.size > 0 && update.size <= 1024.0 * 1024 * 1024 && update.size % 1 == 0.0) { "更新包大小无效" }
        check(Regex("[a-fA-F0-9]{64}").matches(update.sha256)) { "更新包缺少 SHA-256 校验信息" }
        val dir = File(context.cacheDir, "updates").apply { check(isDirectory || mkdirs()) { "无法创建更新缓存" } }
        dir.listFiles()?.filter { it.extension == "apk" || it.extension == "part" }?.forEach { it.delete() }
        val target = File(dir, "yingbox-${update.version}.apk")
        val partial = File(dir, "${target.name}.part")
        val urls = ReleaseMirrors.githubAssetCandidates(update.url)
        check(urls.isNotEmpty()) { "没有可用的更新地址" }
        var lastError: Exception? = null
        for (address in urls) {
            try {
                return downloadOne(address, update, target, partial, onProgress)
            } catch (e: Exception) {
                partial.delete()
                lastError = e
                if (!ReleaseMirrors.canRetryDownload(e)) break
            }
        }
        throw lastError ?: error("下载更新失败")
    }

    /** 主线程调用；拒绝其他应用或不同版本的包，由系统校验签名并确认安装。 */
    fun install(apk: File, version: String): InstallResult {
        val archive = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
        check(archive?.packageName == context.packageName && archive.versionName == version) { "安装包应用或版本不匹配" }
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return InstallResult.NeedsPermission
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        return InstallResult.Started
    }
}
