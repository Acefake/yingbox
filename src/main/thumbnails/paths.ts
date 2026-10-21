/**
 * 图片缓存的 key 与路径（不依赖 Electron；媒体库引擎进程与主进程共用，保证两边算出同一个文件）。
 *
 * 目录 <userData>/library/media：
 * - orig/<key 前两位>/<key>：媒体库引擎下载的原图（不受缩略图上限约束，写出层要复制它们）；
 * - thumb/<key 前两位>/<key>_<宽度>.webp|jpg：全部缩略图，按 LRU 上限淘汰（见 cache.ts）。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** 来源（远程 URL、file:///）→ 缓存 key：SHA-1 前 32 位。 */
export function imageKey(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 32)
}

/** 原图在缓存目录里的路径。 */
export function originalPath(mediaDir: string, key: string): string {
  return join(mediaDir, 'orig', key.slice(0, 2), key)
}

/** 缩略图相对 thumb 目录的文件名。 */
export function thumbName(key: string, width: number, ext: string): string {
  return join(key.slice(0, 2), `${key}_${width}.${ext}`)
}
