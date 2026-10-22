/**
 * 图片缓存的 key 与路径（不依赖 Electron；媒体库引擎进程与主进程共用，保证两边算出同一个文件）。
 *
 * 目录 <userData>/library/media：
 * - orig/<key 前两位>/<key>：媒体库引擎下载的原图（不受缩略图上限约束，写出层要复制它们）；
 * - thumb/<key 前两位>/<key>_<宽度>.webp|jpg：全部缩略图，按 LRU 上限淘汰（见 cache.ts）；
 * - thumb/<key 前两位>/<key>.focus.json：海报取景的焦点（同一个 LRU，见 focus/service.ts）。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { MediaTarget } from '../../shared/media-url'

/** 来源（远程 URL、file:///）→ 缓存 key：SHA-1 前 32 位。 */
export function imageKey(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 32)
}

/** yingbox-media 地址解析结果 → 缓存 key（媒体库图片自带 key，任意来源按地址算）。 */
export function targetKey(target: MediaTarget): string {
  return target.kind === 'image' ? target.key : imageKey(target.source)
}

/** 原图在缓存目录里的路径。 */
export function originalPath(mediaDir: string, key: string): string {
  return join(mediaDir, 'orig', key.slice(0, 2), key)
}

/** 缩略图相对 thumb 目录的文件名。 */
export function thumbName(key: string, width: number, ext: string): string {
  return join(key.slice(0, 2), `${key}_${width}.${ext}`)
}

/** 焦点文件相对 thumb 目录的文件名。 */
export function focusName(key: string): string {
  return join(key.slice(0, 2), `${key}.focus.json`)
}
