package com.yingbox.android.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import com.yingbox.android.server.ServerClient
import com.yingbox.android.settings.ImageQualities
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** 取图失败后的重试间隔（共 1 + 3 次尝试） */
private val RETRY_DELAYS_MS = longArrayOf(800, 2_000, 5_000)

/** 解码后的缩略图，按占用字节数限额（约 1/8 可用堆）。 */
private val cache = object : LruCache<String, ImageBitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
    override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
}

/** 正在取的图：同一路径同时只发一次请求（片单海报和热门行常是同一张）。 */
private val inflight = HashMap<String, Deferred<ImageBitmap?>>()

/** 缩略图路径（/media/thumb?w=&src=…）里的原图地址；不是缩略图路径或不是 http(s) 返回 null */
private fun originalOf(path: String): String? {
    if (!path.startsWith("/media/thumb?")) return null
    val src = android.net.Uri.parse("http://x$path").getQueryParameter("src") ?: return null
    return src.takeIf { it.startsWith("http://") || it.startsWith("https://") }
}

/** 设备直接取原图；只用于服务端缩略图失败时，限 8MB、15 秒 */
private fun directBytes(path: String): ByteArray? {
    val url = originalOf(path) ?: return null
    val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
    c.connectTimeout = 8_000
    c.readTimeout = 15_000
    c.setRequestProperty("User-Agent", "Mozilla/5.0")
    return try {
        if (c.responseCode !in 200..299 || c.contentLengthLong > MAX_ORIGINAL) null
        else c.inputStream.use { it.readBytes() }.takeIf { it.size <= MAX_ORIGINAL }
    } finally {
        c.disconnect()
    }
}

private const val MAX_ORIGINAL = 8L * 1024 * 1024

/** 解码并按宽度 960 以内降采样，原图很大时不占满内存 */
private fun decodeScaled(bytes: ByteArray): android.graphics.Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= 960) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

private suspend fun load(path: String, client: ServerClient): ImageBitmap? {
    cache.get(path)?.let { return it }
    val (deferred, owner) = synchronized(inflight) {
        inflight[path]?.let { it to false } ?: CompletableDeferred<ImageBitmap?>().also { inflight[path] = it }.let { it to true }
    }
    if (!owner) return deferred.await()
    // 协程被取消（滑走、切页）时也要放掉登记并唤醒等同一张图的其他组件，否则它们会永远等下去
    var image: ImageBitmap? = null
    try {
        image = withContext(Dispatchers.IO) {
            runCatching {
                // 服务端缩略图生成偶尔失败（原图解不了、站点图床抽风）：退回设备直接取原图
                val bytes = runCatching { client.bytes(path) }.getOrNull() ?: directBytes(path) ?: return@runCatching null
                decodeScaled(bytes)?.asImageBitmap()
            }.getOrNull()
        }
        image?.let { cache.put(path, it) }
    } finally {
        synchronized(inflight) { inflight.remove(path) }
        (deferred as CompletableDeferred).complete(image)
    }
    return image
}

/**
 * 本服务的图片（/media/thumb?w=&src=、/media/image/…）：服务端已缩放、缓存，这里只解码并放进内存缓存。
 * 加载中和失败时显示占位底色；path 变了就换成新图。
 */
@Composable
fun RemoteImage(requested: String, client: ServerClient, modifier: Modifier = Modifier) {
    // 按设置的图片清晰度换缩略图档位
    val path = ImageQualities.rewrite(requested)
    var image by remember(path) { mutableStateOf(cache.get(path)) }
    LaunchedEffect(path, client) {
        if (image != null || path.isEmpty()) return@LaunchedEffect
        // 失败不进缓存；偶发的网络、上游限流重试几次（间隔递增），首页一屏几十张图并发时常见
        for (wait in RETRY_DELAYS_MS) {
            image = load(path, client)
            if (image != null) return@LaunchedEffect
            delay(wait)
        }
        image = load(path, client)
    }
    val bitmap = image
    if (bitmap == null) {
        Box(modifier.background(YbColor.Elevated))
    } else {
        Image(bitmap, contentDescription = null, modifier = modifier, contentScale = ContentScale.Crop)
    }
}
