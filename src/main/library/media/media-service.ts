/**
 * 主进程侧的媒体图片服务：注册 yingbox-media:// 协议，接引擎“原图已下载”的通知预热缩略图。
 *
 * Electron 胶水都在这里：nativeImage 缩放、worker_threads 编码 WebP、protocol.handle。
 */
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { nativeImage, protocol } from 'electron'
import { MEDIA_SCHEME } from '../../../shared/library/media-url'
import { createMediaHandler } from './media-protocol'
import {
  type ImageResizer,
  type ThumbEncoder,
  Thumbnailer,
} from './thumbnailer'
import type { EncodeRequest, EncodeResponse } from './webp-worker'

/** registerSchemesAsPrivileged 用的协议声明（必须在 app ready 之前注册）。 */
export const MEDIA_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}

/** nativeImage 缩放：BGRA 位图转 RGBA 交给 WebP 编码器。 */
const nativeResize: ImageResizer = async (path, width) => {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return null
  const size = image.getSize()
  const resized =
    size.width > width ? image.resize({ width, quality: 'better' }) : image
  const { width: w, height: h } = resized.getSize()
  const bitmap = resized.toBitmap()
  // Skia 的 N32 像素格式在桌面平台上是 BGRA，交换 R / B 得到 RGBA
  const rgba = new Uint8Array(bitmap.length)
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2]
    rgba[i + 1] = bitmap[i + 1]
    rgba[i + 2] = bitmap[i]
    rgba[i + 3] = bitmap[i + 3]
  }
  return {
    rgba,
    width: w,
    height: h,
    jpeg: quality => new Uint8Array(resized.toJPEG(quality)),
  }
}

/** 启动 WebP 编码线程，返回编码函数；线程起不来时返回 undefined（退回 JPEG）。 */
function startEncoder(
  log: (message: string) => void
): ThumbEncoder | undefined {
  let worker: Worker
  try {
    worker = new Worker(join(__dirname, 'webp-worker.js'))
  } catch (error) {
    log(`WebP 编码线程启动失败：${(error as Error).message}`)
    return undefined
  }
  worker.unref()
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }
  >()
  worker.on('message', (message: EncodeResponse) => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if ('data' in message) entry.resolve(message.data)
    else entry.reject(new Error(message.error))
  })
  worker.on('error', error => {
    log(`WebP 编码线程出错：${error.message}`)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  })
  return (rgba, width, height, quality) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      const request: EncodeRequest = { id, rgba, width, height, quality }
      worker.postMessage(request, [rgba.buffer as ArrayBuffer])
    })
}

/** 媒体图片服务。 */
export interface MediaService {
  /** 引擎下载好一批原图后调用，后台生成缩略图。 */
  warm(keys: string[]): void
}

/** 注册 yingbox-media:// 协议处理（app ready 之后调用）。 */
export function registerMediaProtocol(
  mediaDir: string,
  log: (message: string) => void = message => console.warn(`[media] ${message}`)
): MediaService {
  const thumbnailer = new Thumbnailer(
    mediaDir,
    nativeResize,
    startEncoder(log),
    log
  )
  protocol.handle(MEDIA_SCHEME, createMediaHandler(mediaDir, thumbnailer))
  return { warm: keys => thumbnailer.warm(keys) }
}
