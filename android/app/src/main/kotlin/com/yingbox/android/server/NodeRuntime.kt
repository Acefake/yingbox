package com.yingbox.android.server

import android.content.Context
import android.os.Build
import android.os.Environment
import android.system.Os
import java.io.File
import java.io.FileNotFoundException
import java.security.SecureRandom
import java.util.zip.ZipInputStream

/**
 * 准备 node 的运行文件，拼出启动命令（ADR-0029）。
 *
 * - node 是 nativeLibraryDir 里的 libnode.so，安卓只允许执行这个目录里的文件；
 * - 服务端从 assets/server.zip 解压到私有目录，按安装时间判断版本，同一次安装只解压一次；
 * - assets/node/libs.txt 列出带版本号的库名，在私有目录建同名符号链接指向打包的库。
 */
class NodeRuntime(private val context: Context) {
    private val files = context.filesDir
    private val libDir = context.applicationInfo.nativeLibraryDir

    /** 每次安装生成一次的访问令牌。放在不参与备份的目录。 */
    val token: String by lazy {
        val file = File(context.noBackupFilesDir, "server-token")
        file.takeIf { it.exists() }?.readText()?.trim()?.takeIf { it.length >= 32 }
            ?: ByteArray(32).also { SecureRandom().nextBytes(it) }
                .joinToString("") { "%02x".format(it) }
                .also { file.writeText(it) }
    }

    /** 解压服务端、建库链接，返回服务端目录。幂等：中途被杀，下次从头再来。 */
    fun prepare(): File {
        val version = installStamp()
        val root = File(files, "server")
        val target = File(root, version)
        if (!File(target, "out/server/server.js").exists()) {
            val partial = File(root, "$version.partial")
            partial.deleteRecursively()
            unzip(partial)
            check(partial.renameTo(target)) { "无法移动服务端目录到 $target" }
        }
        root.listFiles()?.filter { it.name != version }?.forEach { it.deleteRecursively() }
        linkLibraries()
        return target
    }

    /** 启动命令。端口每次随机，数据放私有目录，媒体根目录先给共享存储根（读权限后续阶段申请）。 */
    fun command(serverDir: File, port: Int): ProcessBuilder {
        val node = File(libDir, "libnode.so")
        check(node.canExecute()) { "不能执行 $node（APK 需要 useLegacyPackaging）" }
        val data = File(files, "server-data").apply { mkdirs() }
        val cache = File(context.cacheDir, "server").apply { mkdirs() }
        return ProcessBuilder(
            node.path,
            "--use-bundled-ca",
            "--disable-warning=ExperimentalWarning",
            "out/server/server.js",
        ).directory(serverDir).redirectErrorStream(true).also { builder ->
            builder.environment().apply {
                put("LD_LIBRARY_PATH", "${linkDir.path}:$libDir")
                put("HOME", files.path)
                put("TMPDIR", context.cacheDir.path)
                put("YINGBOX_HOST", "127.0.0.1")
                put("YINGBOX_PORT", port.toString())
                put("YINGBOX_SERVER_TOKEN", token)
                put("YINGBOX_DATA_DIR", data.path)
                put("YINGBOX_CACHE_DIR", cache.path)
                put("YINGBOX_MEDIA_ROOTS", Environment.getExternalStorageDirectory().path)
                put("YINGBOX_WEB_DIR", "off")
                put("YINGBOX_ONLINE", "on")
            }
        }
    }

    private val linkDir get() = File(files, "node-libs")

    private fun linkLibraries() {
        // 静态链接的 Node 不需要改名的库，清单可以不存在
        val lines = try {
            context.assets.open("node/libs.txt").bufferedReader().readLines()
        } catch (_: FileNotFoundException) {
            emptyList()
        }
        val links = lines
            .map { it.trim() }.filter { it.isNotEmpty() }
            .map { line -> line.split(' ').let { it[0] to it[1] } }
        linkDir.deleteRecursively()
        linkDir.mkdirs()
        for ((name, packaged) in links) Os.symlink("$libDir/$packaged", File(linkDir, name).path)
    }

    private fun installStamp(): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        return "$code-${info.lastUpdateTime}"
    }

    private fun unzip(target: File) {
        val base = target.canonicalPath + File.separator
        ZipInputStream(context.assets.open("server.zip").buffered()).use { zip ->
            generateSequence { zip.nextEntry }.forEach { entry ->
                val file = File(target, entry.name)
                check(file.canonicalPath.startsWith(base)) { "压缩包路径越界：${entry.name}" }
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    file.outputStream().use { zip.copyTo(it) }
                }
            }
        }
    }
}
