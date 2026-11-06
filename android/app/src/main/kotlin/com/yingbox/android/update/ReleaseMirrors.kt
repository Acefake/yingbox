package com.yingbox.android.update

import java.io.IOException
import com.yingbox.android.settings.NetworkOptions
import java.net.URI

/**
 * GitHub 发布源镜像改写（与 src/shared/release/mirrors.ts 同构，ADR-0046）。
 */
object ReleaseMirrors {
    const val PREFIX = "https://gh-proxy.com/"

    private val hosts = setOf(
        "api.github.com",
        "github.com",
        "objects.githubusercontent.com",
        "raw.githubusercontent.com",
    )

    fun isGithubMirrorHost(host: String): Boolean = host.lowercase() in hosts

    /** 官方 URL → 候选列表；非 https / 非法 → 空；非白名单 → 仅自身。 */
    fun candidates(url: String, options: NetworkOptions = NetworkOptions()): List<String> {
        val parsed = runCatching { URI(url) }.getOrNull() ?: return emptyList()
        if (parsed.scheme != "https") return emptyList()
        val host = parsed.host ?: return emptyList()
        if (!isGithubMirrorHost(host)) return listOf(url)
        if (parsed.userInfo != null || parsed.port != -1) return emptyList()
        if (options.githubMode == "direct") return listOf(url)
        val prefixes = options.mirrors.filter { host != "api.github.com" || it == PREFIX }
        return listOf(url) + prefixes.map { it + url }
    }

    /** 安装包下载：只接受白名单 GitHub 主机。 */
    fun githubAssetCandidates(url: String, options: NetworkOptions = NetworkOptions()): List<String> {
        val parsed = runCatching { URI(url) }.getOrNull() ?: return emptyList()
        if (parsed.scheme != "https") return emptyList()
        val host = parsed.host ?: return emptyList()
        if (!isGithubMirrorHost(host)) return emptyList()
        return candidates(url, options)
    }

    /** 网络 / 429 / 5xx / 校验失败可换源；其它 4xx 不换。 */
    fun canRetryDownload(error: Throwable): Boolean {
        val message = error.message.orEmpty()
        if (
            "校验失败" in message ||
            "下载不完整" in message ||
            "超出预期" in message
        ) {
            return true
        }
        val status = Regex("""HTTP (\d+)""").find(message)?.groupValues?.get(1)?.toIntOrNull()
        if (status != null) return status >= 500
        return error is IOException
    }
}
