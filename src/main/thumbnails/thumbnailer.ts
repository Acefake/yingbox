/**
 * 缩略图生成（桌面端主进程 / 独立服务进程）：原图 → 指定宽度的 WebP，写进 LRU 缓存（cache.ts）。
 *
 * - 原图：本地文件路径（媒体库原图、本地图片）或内存字节（远程图片），由调用方的 load 提供；
 * - 缩放：经 ImageResizer 注入。桌面端用 Electron nativeImage（native-resizer.ts，Skia、几毫秒，只在主进程可用）；
 *   独立服务用编解码线程里的 wasm（wasm-resizer.ts，无原生依赖）；
 * - 编码：WebP 由独立 worker 线程编码（wasm libwebp），不占宿主事件循环；
 *   编码器不可用时退回缩放器给的 JPEG，文件扩展名随之是 .jpg；
 * - 同一张图同一宽度的生成在途去重，同时生成数受限；预热（引擎下载完原图后通知）串行执行。
 *
 * 宿主差异经 ImageResizer 注入，单测用假的实现。
 */
import { THUMB_WIDTHS, type ThumbWidth } from '../../shared/media-url'
import type { ThumbCache } from './cache'
import { thumbName } from './paths'

/** 原图：本地文件或内存字节。 */
export type OriginalImage = { path: string } | { bytes: Uint8Array }

/** 缩放结果：RGBA 像素，以及同一张图的 JPEG 编码（编码器不可用时兜底）。 */
export interface ResizedImage {
  rgba: Uint8Array
  width: number
  height: number
  jpeg(quality: number): Uint8Array | Promise<Uint8Array>
}

/** 把原图缩放到指定宽度（原图更窄时不放大）；解不了返回 null。 */
export type ImageResizer = (
  original: OriginalImage,
  width: number
) => Promise<ResizedImage | null>

/** WebP 编码。 */
export type ThumbEncoder = (
  rgba: Uint8Array,
  width: number,
  height: number,
  quality: number
) => Promise<Uint8Array>

/** 取原图；原图不存在返回 null。 */
export type OriginalLoader = () => Promise<OriginalImage | null>

/** 生成好的缩略图。 */
export interface ThumbFile {
  path: string
  contentType: 'image/webp' | 'image/jpeg'
}

/** WebP 质量。 */
const QUALITY = 80
/** 同时生成几张（下载 + 缩放 + 编码）。 */
const CONCURRENCY = 4

/** 缩略图生成器。 */
export class Thumbnailer {
  private readonly inflight = new Map<string, Promise<ThumbFile | null>>()
  private readonly waiting: Array<() => void> = []
  private running = 0
  private warmQueue: Array<{ key: string; load: OriginalLoader }> = []
  private warming = false
  /** 已打印过的警告：同一原因（如编码器缺失）每张图都会碰到，只记一次。 */
  private readonly warned = new Set<string>()

  constructor(
    private readonly cache: ThumbCache,
    private readonly resize: ImageResizer,
    private readonly encode: ThumbEncoder | undefined,
    private readonly log: (message: string) => void = () => {}
  ) {}

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.log(message)
  }

  /** 取缩略图，不在缓存里就用 load 取原图生成；原图不存在或解不了返回 null。 */
  ensure(
    key: string,
    width: ThumbWidth,
    load: OriginalLoader
  ): Promise<ThumbFile | null> {
    const id = `${key}_${width}`
    let pending = this.inflight.get(id)
    if (!pending) {
      pending = this.lookup(key, width)
        .then(hit => hit ?? this.limited(() => this.generate(key, width, load)))
        .finally(() => this.inflight.delete(id))
      this.inflight.set(id, pending)
    }
    return pending
  }

  /** 预热：后台依次为这些原图生成全部宽度的缩略图。 */
  warm(items: Array<{ key: string; load: OriginalLoader }>): void {
    this.warmQueue.push(...items)
    if (this.warming) return
    this.warming = true
    void (async () => {
      while (this.warmQueue.length) {
        const { key, load } = this.warmQueue.shift()!
        for (const width of THUMB_WIDTHS) {
          await this.ensure(key, width, load).catch(error =>
            this.log(`生成缩略图失败 ${key}：${(error as Error).message}`)
          )
        }
      }
      this.warming = false
    })()
  }

  /** 预热队列与在途生成是否都已结束（测试用）。 */
  async idle(): Promise<void> {
    while (this.warming || this.inflight.size) {
      await Promise.all([...this.inflight.values()]).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  private async lookup(
    key: string,
    width: ThumbWidth
  ): Promise<ThumbFile | null> {
    const webp = await this.cache.find(thumbName(key, width, 'webp'))
    if (webp) return { path: webp, contentType: 'image/webp' }
    const jpg = await this.cache.find(thumbName(key, width, 'jpg'))
    if (jpg) return { path: jpg, contentType: 'image/jpeg' }
    return null
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY)
      await new Promise<void>(resolve => this.waiting.push(resolve))
    this.running++
    try {
      return await task()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  private async generate(
    key: string,
    width: ThumbWidth,
    load: OriginalLoader
  ): Promise<ThumbFile | null> {
    const original = await load()
    if (!original) return null
    const resized = await this.resize(original, width)
    if (!resized) return null
    let file: { data: Uint8Array; ext: 'webp' | 'jpg' }
    try {
      if (!this.encode) throw new Error('WebP 编码器不可用')
      const data = await this.encode(
        resized.rgba,
        resized.width,
        resized.height,
        QUALITY
      )
      file = { data, ext: 'webp' }
    } catch (error) {
      this.warnOnce(`WebP 编码失败，改用 JPEG：${(error as Error).message}`)
      file = { data: await resized.jpeg(QUALITY), ext: 'jpg' }
    }
    const path = await this.cache.put(
      thumbName(key, width, file.ext),
      file.data
    )
    return {
      path,
      contentType: file.ext === 'webp' ? 'image/webp' : 'image/jpeg',
    }
  }
}
