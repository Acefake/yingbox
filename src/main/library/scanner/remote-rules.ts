/**
 * 远程源（WebDAV）遍历的增量规则：把目录的 etag / getlastmodified 换算成存进 dirs.mtime 的「版本戳」。
 *
 * - 有 etag：取 etag + 修改时间的哈希（正数，不会等于 RACY_MTIME）；
 * - 只有修改时间：直接用毫秒数；刚改过（在 racyBefore 之后）的记 RACY，下次必然重读，
 *   理由同本地遍历：时间戳有粒度，同一秒内的第二次改动看不出来；
 * - 两样都没有、或修改时间是 0 / 1970（部分网盘挂到 Alist 后目录没有时间）：记 RACY，每次都重读。
 *
 * 版本戳没变的目录跳过列目录，只对已知子目录逐个取版本戳（Depth: 0）。目录版本戳只反映直接子项，
 * 和本地目录 mtime 一样，所以孙子层的变化要靠下钻发现。
 */
import type { DavEntry } from '../../../shared/webdav/propfind'
import { RACY_MTIME } from './walk'

/** 两个 32 位乘法哈希拼成 53 位以内的正整数（安全整数范围内，可精确存进 REAL）。 */
function hashStamp(text: string): number {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return (a >>> 1) * 0x200000 + (b & 0x1fffff) + 1
}

/** 修改时间早于这个值（2000-01-01）的当成没给：常见于不维护目录时间的存储。 */
const MIN_TRUSTED_MTIME = Date.UTC(2000, 0, 1)

/** 目录的版本戳；racyBefore 之后的修改时间不可信。 */
export function dirStamp(
  entry: Pick<DavEntry, 'etag' | 'lastModified'> | undefined,
  racyBefore: number
): number {
  if (!entry) return RACY_MTIME
  const mtime =
    entry.lastModified !== null && entry.lastModified >= MIN_TRUSTED_MTIME
      ? entry.lastModified
      : null
  if (entry.etag) return hashStamp(`${entry.etag}|${mtime ?? ''}`)
  if (mtime === null || mtime > racyBefore) return RACY_MTIME
  return mtime
}

/** 文件的修改时间（存进 files.mtime，和大小一起判断变更）；没给时为 0。 */
export function fileMtime(entry: Pick<DavEntry, 'lastModified'>): number {
  return entry.lastModified ?? 0
}

/**
 * 目录能不能跳过列目录：不是强制 / 全量、快照里有这个目录、两边版本戳相同且可信。
 * 本次版本戳为 undefined 表示还不知道（要先取一次 Depth: 0）。
 */
export function canReuseDir(
  prevStamp: number | undefined,
  stamp: number,
  force: boolean
): boolean {
  return (
    !force &&
    prevStamp !== undefined &&
    stamp !== RACY_MTIME &&
    prevStamp === stamp
  )
}
