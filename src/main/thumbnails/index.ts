/**
 * 缩略图模块入口（Electron 胶水）：注册 yingbox-media:// 协议，全应用唯一一套缩略图。
 *
 * - 一个协议：媒体库原图（image/<key>）与任意来源（thumb/?src=）都走 yingbox-media://；
 * - 一个缓存目录：<userData>/library/media/thumb，一个 LRU 上限（cache.ts）；
 * - 生成在主进程：nativeImage 缩放 + worker_threads 里的 wasm 编码 WebP（thumbnailer.ts）。
 *   不在渲染层 Worker 生成：file:// 页面里起 Worker 有打包风险，且本地图片本来就要主进程读。
 */
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { app, nativeImage, protocol } from 'electron'
import { MEDIA_SCHEME } from '../../shared/media-url'
import { fetchHttp, readLimited } from '../http-client'
import { refererFor } from '../media-headers'
import { ThumbCache, exists } from './cache'
import { originalPath } from './paths'
import { createMediaHandler } from './protocol'
import { createSourceLoader, isWebp } from './sources'
import {
  type ImageResizer,
  type OriginalImage,
  type ThumbEncoder,
  Thumbnailer,
} from './thumbnailer'
import type { CodecJob, CodecResponse } from './webp-worker'

/** registerSchemesAsPrivileged 用的协议声明（必须在 app ready 之前注册）。 */
export const MEDIA_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}

/** 媒体库图片目录（引擎的 orig/ 与全部缩略图 thumb/）。 */
export const mediaDir = (): string =>
  join(app.getPath('userData'), 'library', 'media')

/** 非 http(s) 来源的取图函数，按协议登记（如 amane:） */
const loaders = new Map<string, (source: string) => Promise<Response>>()

/** 插件登记自己协议的原图读取（返回图片 Response） */
export function registerThumbSource(
  scheme: string,
  load: (source: string) => Promise<Response>
): void {
  loaders.set(scheme, load)
}

/** 编解码成功的结果（decode 带宽高）。 */
type CodecResult = Extract<CodecResponse, { data: Uint8Array }>
/** 向编解码线程发一个请求。 */
type Codec = (
  request: CodecJob,
  transfer: ArrayBuffer[]
) => Promise<CodecResult>

/** 启动 WebP 编解码线程；线程起不来时返回 undefined（退回 JPEG、不解 WebP 原图）。 */
function startCodec(log: (message: string) => void): Codec | undefined {
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
    { resolve: (r: CodecResult) => void; reject: (e: Error) => void }
  >()
  worker.on('message', (message: CodecResponse) => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if ('data' in message) entry.resolve(message)
    else entry.reject(new Error(message.error))
  })
  worker.on('error', error => {
    log(`WebP 编码线程出错：${error.message}`)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  })
  return (request, transfer) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...request, id }, transfer)
    })
}

/** BGRA ↔ RGBA（交换 R / B，两个方向是同一个操作）。 */
function swapRedBlue(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = pixels[i + 2]
    out[i + 1] = pixels[i + 1]
    out[i + 2] = pixels[i]
    out[i + 3] = pixels[i + 3]
  }
  return out
}

/** nativeImage 缩放；nativeImage 只认 PNG / JPEG，WebP 原图先交编码线程解码。 */
function createResizer(codec: Codec | undefined): ImageResizer {
  const decodeWebp = async (
    bytes: Uint8Array
  ): Promise<Electron.NativeImage> => {
    if (!codec || !isWebp(bytes)) return nativeImage.createEmpty()
    const copy = bytes.slice()
    const image = await codec({ op: 'decode', bytes: copy }, [
      copy.buffer as ArrayBuffer,
    ])
    // Skia 的 N32 像素格式在桌面平台上是 BGRA
    return nativeImage.createFromBitmap(Buffer.from(swapRedBlue(image.data)), {
      width: image.width!,
      height: image.height!,
    })
  }
  const open = async (
    original: OriginalImage
  ): Promise<Electron.NativeImage> => {
    const image =
      'path' in original
        ? nativeImage.createFromPath(original.path)
        : nativeImage.createFromBuffer(Buffer.from(original.bytes))
    if (!image.isEmpty()) return image
    return decodeWebp(
      'path' in original
        ? new Uint8Array(await readFile(original.path))
        : original.bytes
    )
  }
  return async (original, width) => {
    const image = await open(original)
    if (image.isEmpty()) return null
    const resized =
      image.getSize().width > width
        ? image.resize({ width, quality: 'better' })
        : image
    const size = resized.getSize()
    return {
      rgba: swapRedBlue(resized.toBitmap()),
      width: size.width,
      height: size.height,
      jpeg: quality => new Uint8Array(resized.toJPEG(quality)),
    }
  }
}

/** 缩略图服务（给媒体库主进程宿主用）。 */
export interface ThumbnailService {
  /** 引擎下载好一批原图后调用，后台生成全部宽度的缩略图。 */
  warm(keys: string[]): void
}

/** 注册 yingbox-media:// 协议（app ready 之后调用）。 */
export function registerThumbnails(
  log: (message: string) => void = message => console.warn(`[thumb] ${message}`)
): ThumbnailService {
  const dir = mediaDir()
  const codec = startCodec(log)
  const encode: ThumbEncoder | undefined = codec
    ? async (rgba, width, height, quality) =>
        (
          await codec({ op: 'encode', rgba, width, height, quality }, [
            rgba.buffer as ArrayBuffer,
          ])
        ).data
    : undefined
  const thumbnailer = new Thumbnailer(
    new ThumbCache(join(dir, 'thumb')),
    createResizer(codec),
    encode,
    log
  )
  const loadSource = createSourceLoader({
    loaders,
    readLimited,
    fetchImage: source =>
      fetchHttp(
        source,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            // 与 <img referrerpolicy="no-referrer"> 一致：只给名单里的防盗链 CDN 带 Referer
            ...(refererFor(source) ? { Referer: refererFor(source)! } : {}),
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        15000
      ),
  })
  protocol.handle(
    MEDIA_SCHEME,
    createMediaHandler({ mediaDir: dir, thumbnailer, loadSource })
  )
  // 旧版独立缩略图缓存（thumb:// 时期，userData/thumb-cache）已不再使用
  void rm(join(app.getPath('userData'), 'thumb-cache'), {
    recursive: true,
    force: true,
  }).catch(() => {})
  return {
    warm: keys =>
      thumbnailer.warm(
        keys.map(key => ({
          key,
          load: async () => {
            const path = originalPath(dir, key)
            return (await exists(path)) ? { path } : null
          },
        }))
      ),
  }
}
