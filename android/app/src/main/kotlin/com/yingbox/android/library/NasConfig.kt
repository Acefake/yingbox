package com.yingbox.android.library

/** NAS 上影盒服务的连接配置（ADR-0040）：地址已规范化，令牌可为空（服务没开鉴权时） */
data class NasConfig(val url: String, val token: String)

/**
 * 用户输入的地址 → 规范地址：没写协议补 `http://`，去首尾空白和尾部斜杠；
 * 空串、非 http(s) 协议、含空白、没有主机名的返回 null。
 */
fun normalizeNasUrl(raw: String): String? {
    val text = raw.trim()
    if (text.isEmpty() || text.any { it.isWhitespace() }) return null
    val withScheme = if ("://" in text) text else "http://$text"
    val scheme = withScheme.substringBefore("://").lowercase()
    if (scheme != "http" && scheme != "https") return null
    val rest = withScheme.substringAfter("://").trimEnd('/')
    if (rest.isEmpty()) return null
    // 主机名不能为空：http://:80、http://user@ 都不是地址（主机名里的下划线等不做更多限制）
    val authority = rest.substringBefore('/').substringBefore('?')
    val hostPort = authority.substringAfterLast('@')
    val host = if (hostPort.startsWith("[")) hostPort.substringBefore(']').removePrefix("[") else hostPort.substringBeforeLast(':', hostPort)
    if (host.isEmpty()) return null
    return withScheme.substringBefore("://") + "://" + rest
}
