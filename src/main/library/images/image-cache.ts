/**
 * 图片原图缓存（引擎进程）：把选中的海报 / 背景图下载到 <mediaDir>/orig/<key 前两位>/<key>。
 *
 * key = URL 的 SHA-1 前 32 位，同一 URL 只下载一次；images 表记录状态，失败的最多重试 3 次。
 * 缩略图由主进程生成：下载完成后经 onCached 通知主进程预热（见 src/main/thumbnails）。
 * key 与路径规则和主进程共用 thumbnails/paths.ts，两边算出同一个文件。
 * 防盗链图床（如番号库的 JavBus 图片）按 shared/net/media-referer 的名单带上 Referer。
 */
import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mediaImageUrl } from '../../../shared/media-url'
import { refererFor } from '../../../shared/net/media-referer'
import { imageKey, originalPath } from '../../thumbnails/paths'
import { type LibraryDb, StatementCache } from '../db/database'
import { Semaphore } from '../providers/http/rate-limiter'

/** 下载图片用的 fetch 子集。 */
export type BinaryFetch = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

/** 单张图片大小上限。 */
const MAX_BYTES = 15 * 1024 * 1024
/** 失败几次后不再尝试。 */
const MAX_ATTEMPTS = 3

/** 按文件头判断是不是常见图片格式（JPEG / PNG / GIF / WebP）。 */
export function looksLikeImage(b: Uint8Array): boolean {
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...b.subarray(from, to))
  return (
    (b[0] === 0xff && b[1] === 0xd8) ||
    (b[0] === 0x89 && ascii(1, 4) === 'PNG') ||
    ascii(0, 4) === 'GIF8' ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
  )
}

/** 构造参数。 */
export interface ImageCacheOptions {
  db: LibraryDb
  /** 缓存根目录（<userData>/library/media）。 */
  mediaDir: string
  fetch: BinaryFetch
  /** 同时下载数，默认 4。 */
  concurrency?: number
  /** 一批原图落盘后回调（主进程据此生成缩略图）。 */
  onCached?: (keys: string[]) => void
  /** 单次下载超时，默认 30 s。 */
  timeoutMs?: number
}

/** 原图缓存。 */
export class ImageCache {
  private readonly sql: StatementCache
  private readonly slots: Semaphore
  private readonly inflight = new Map<string, Promise<boolean>>()

  constructor(private readonly options: ImageCacheOptions) {
    this.sql = new StatementCache(options.db)
    this.slots = new Semaphore(options.concurrency ?? 4)
  }

  /**
   * 确保这些 URL 已缓存，返回 URL → yingbox-media 地址（失败为 null）。
   * 已缓存的直接返回，不读文件系统。
   */
  async ensure(
    urls: string[],
    signal?: AbortSignal
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>()
    const fresh: string[] = []
    await Promise.all(
      [...new Set(urls)].map(async url => {
        const key = imageKey(url)
        const ok = await this.ensureOne(url, key, signal)
        result.set(url, ok ? mediaImageUrl(key) : null)
        if (ok === 'downloaded') fresh.push(key)
      })
    )
    if (fresh.length) this.options.onCached?.(fresh)
    return result
  }

  /**
   * 确保 URL 已缓存并返回原图文件路径（写出层复制到媒体库用）；失败返回 null。
   * 记录为已缓存但文件被删掉时，清掉记录重新下载一次。
   */
  async ensureFile(url: string, signal?: AbortSignal): Promise<string | null> {
    const key = imageKey(url)
    const path = originalPath(this.options.mediaDir, key)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await this.ensure([url], signal)).get(url)) return null
      if (
        await access(path).then(
          () => true,
          () => false
        )
      )
        return path
      this.sql.get('DELETE FROM images WHERE key = ?').run(key)
    }
    return null
  }

  private async ensureOne(
    url: string,
    key: string,
    signal?: AbortSignal
  ): Promise<'cached' | 'downloaded' | false> {
    const row = this.sql
      .get('SELECT state, attempts FROM images WHERE key = ?')
      .get(key)
    if (row?.state === 'cached') return 'cached'
    if (row?.state === 'error' && Number(row.attempts) >= MAX_ATTEMPTS) {
      return false
    }
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.download(url, key, signal).finally(() =>
        this.inflight.delete(key)
      )
      this.inflight.set(key, pending)
    }
    return (await pending) ? 'downloaded' : false
  }

  private async download(
    url: string,
    key: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const release = await this.slots.acquire()
    const target = originalPath(this.options.mediaDir, key)
    const temp = `${target}.${randomUUID()}.partial`
    try {
      signal?.throwIfAborted()
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
      const referer = refererFor(url)
      const response = await this.options.fetch(url, {
        ...(referer ? { headers: { Referer: referer } } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const type = response.headers.get('content-type') ?? ''
      // 个别图床（如 mgstage）给图片标 binary/octet-stream，下载后再按文件头确认
      const opaque = /octet-stream/i.test(type)
      if (type && !type.startsWith('image/') && !opaque) {
        throw new Error(`不是图片：${type}`)
      }
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_BYTES) throw new Error('图片过大')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!bytes.length || bytes.length > MAX_BYTES) {
        throw new Error('图片为空或过大')
      }
      if (opaque && !looksLikeImage(bytes)) throw new Error(`不是图片：${type}`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(temp, bytes)
      await rename(temp, target)
      this.record(key, url, 'cached', bytes.length)
      return true
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      if (signal?.aborted) throw error
      this.record(key, url, 'error', null, (error as Error).message)
      return false
    } finally {
      release()
    }
  }

  private record(
    key: string,
    url: string,
    state: 'cached' | 'error',
    bytes: number | null,
    error?: string
  ): void {
    this.sql
      .get(
        `INSERT INTO images (key, url, state, bytes, attempts, error, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (key) DO UPDATE SET state = excluded.state,
           bytes = excluded.bytes, error = excluded.error,
           attempts = images.attempts + 1, updated_at = excluded.updated_at`
      )
      .run(key, url, state, bytes, error ?? null, Date.now())
  }
}
