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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 解码后的缩略图，按占用字节数限额（约 1/8 可用堆）。 */
private val cache = object : LruCache<String, ImageBitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
    override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
}

/** 正在取的图：同一路径同时只发一次请求（片单海报和热门行常是同一张）。 */
private val inflight = HashMap<String, Deferred<ImageBitmap?>>()

private suspend fun load(path: String, client: ServerClient): ImageBitmap? {
    cache.get(path)?.let { return it }
    val (deferred, owner) = synchronized(inflight) {
        inflight[path]?.let { it to false } ?: CompletableDeferred<ImageBitmap?>().also { inflight[path] = it }.let { it to true }
    }
    if (!owner) return deferred.await()
    val image = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = client.bytes(path)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    image?.let { cache.put(path, it) }
    synchronized(inflight) { inflight.remove(path) }
    (deferred as CompletableDeferred).complete(image)
    return image
}

/**
 * 本服务的图片（/media/thumb?w=&src=、/media/image/…）：服务端已缩放、缓存，这里只解码并放进内存缓存。
 * 加载中和失败时显示占位底色；path 变了就换成新图。
 */
@Composable
fun RemoteImage(path: String, client: ServerClient, modifier: Modifier = Modifier) {
    var image by remember(path) { mutableStateOf(cache.get(path)) }
    LaunchedEffect(path, client) {
        if (image == null && path.isNotEmpty()) image = load(path, client)
    }
    val bitmap = image
    if (bitmap == null) {
        Box(modifier.background(Color(0xFF1C1C1E)))
    } else {
        Image(bitmap, contentDescription = null, modifier = modifier, contentScale = ContentScale.Crop)
    }
}
