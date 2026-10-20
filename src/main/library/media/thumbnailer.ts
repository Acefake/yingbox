/**
 * 缩略图生成（主进程）：原图 → 300w / 780w WebP，写到 <mediaDir>/thumb/<key 前两位>/<key>_<w>.webp。
 *
 * - 缩放：Electron nativeImage（Skia，原生、几毫秒）。nativeImage 在 utilityProcess 里不可用，
 *   所以缩放放在主进程；
 * - 编码：WebP 由独立 worker 线程编码（wasm libwebp），不占主进程事件循环；
 *   编码器不可用时退回 nativeImage 的 JPEG，文件扩展名随之是 .jpg；
 * - 同一张图同一宽度的生成在途去重；预热（引擎下载完原图后通知）串行执行，不和按需请求抢资源。
 *
 * Electron 依赖经 ImageResizer 注入，单测用假的实现。
 */
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  THUMB_WIDTHS,
  type ThumbWidth,
} from '../../../shared/library/media-url'

/** 缩放结果：RGBA 像素，以及同一张图的 JPEG 编码（编码器不可用时兜底）。 */
export interface ResizedImage {
  rgba: Uint8Array
  width: number
  height: number
  jpeg(quality: number): Uint8Array
}

/** 把原图缩放到指定宽度（原图更窄时不放大）；读不了返回 null。 */
export type ImageResizer = (
  path: string,
  width: number
) => Promise<ResizedImage | null>

/** WebP 编码。 */
export type ThumbEncoder = (
  rgba: Uint8Array,
  width: number,
  height: number,
  quality: number
) => Promise<Uint8Array>

/** 生成好的缩略图。 */
export interface ThumbFile {
  path: string
  contentType: 'image/webp' | 'image/jpeg'
}

/** WebP 质量。 */
const QUALITY = 80

/** 原图路径（与引擎 images/image-cache.ts 的 originalPath 一致）。 */
export const originalFile = (mediaDir: string, key: string): string =>
  join(mediaDir, 'orig', key.slice(0, 2), key)

const thumbFile = (
  mediaDir: string,
  key: string,
  width: number,
  ext: string
): string => join(mediaDir, 'thumb', key.slice(0, 2), `${key}_${width}.${ext}`)

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/** 缩略图生成器。 */
export class Thumbnailer {
  private readonly inflight = new Map<string, Promise<ThumbFile | null>>()
  private warmQueue: string[] = []
  private warming = false

  constructor(
    private readonly mediaDir: string,
    private readonly resize: ImageResizer,
    private readonly encode: ThumbEncoder | undefined,
    private readonly log: (message: string) => void = () => {}
  ) {}

  /** 取缩略图，不存在就生成；原图不存在返回 null。 */
  ensure(key: string, width: ThumbWidth): Promise<ThumbFile | null> {
    const id = `${key}_${width}`
    let pending = this.inflight.get(id)
    if (!pending) {
      pending = this.generate(key, width).finally(() =>
        this.inflight.delete(id)
      )
      this.inflight.set(id, pending)
    }
    return pending
  }

  /** 预热：后台依次为这些原图生成全部宽度的缩略图。 */
  warm(keys: string[]): void {
    this.warmQueue.push(...keys)
    if (this.warming) return
    this.warming = true
    void (async () => {
      while (this.warmQueue.length) {
        const key = this.warmQueue.shift()!
        for (const width of THUMB_WIDTHS) {
          await this.ensure(key, width).catch(error =>
            this.log(`生成缩略图失败 ${key}：${(error as Error).message}`)
          )
        }
      }
      this.warming = false
    })()
  }

  /** 预热队列是否已清空（测试用）。 */
  async idle(): Promise<void> {
    while (this.warming || this.inflight.size) {
      await Promise.all([...this.inflight.values()]).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  private async generate(
    key: string,
    width: ThumbWidth
  ): Promise<ThumbFile | null> {
    const webp = thumbFile(this.mediaDir, key, width, 'webp')
    if (await exists(webp)) return { path: webp, contentType: 'image/webp' }
    const jpg = thumbFile(this.mediaDir, key, width, 'jpg')
    if (await exists(jpg)) return { path: jpg, contentType: 'image/jpeg' }

    const original = originalFile(this.mediaDir, key)
    if (!(await exists(original))) return null
    const resized = await this.resize(original, width)
    if (!resized) return null
    let data: Uint8Array
    let file: ThumbFile
    try {
      if (!this.encode) throw new Error('WebP 编码器不可用')
      data = await this.encode(
        resized.rgba,
        resized.width,
        resized.height,
        QUALITY
      )
      file = { path: webp, contentType: 'image/webp' }
    } catch (error) {
      this.log(`WebP 编码失败，改用 JPEG：${(error as Error).message}`)
      data = resized.jpeg(QUALITY)
      file = { path: jpg, contentType: 'image/jpeg' }
    }
    await mkdir(dirname(file.path), { recursive: true })
    const temp = `${file.path}.${randomUUID()}.partial`
    try {
      await writeFile(temp, data)
      await rename(temp, file.path)
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
    return file
  }
}
