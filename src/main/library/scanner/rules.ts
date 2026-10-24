/**
 * 扫描收录规则：哪些目录项进媒体库，以及路径键的约定。引擎使用；bench 里的旧扫描器（scripts/legacy/media-scanner.ts）也复用它做对照。
 */
import { extname } from 'node:path'
import type { LibraryFileKind } from '../../../shared/library/ipc'
import { isRemotePath } from '../../../shared/webdav/remote-path'

/** 视频扩展名（小写，带点）。 */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mp4',
  '.avi',
  '.mkv',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.ts',
  '.rmvb',
])

/** 整个跳过的目录 / 文件名（小写）：NAS 缩略图、回收站、系统目录。 */
export const IGNORED_NAMES: ReadonlySet<string> = new Set([
  '.actors',
  '@eadir',
  '$recycle.bin',
  'system volume information',
])

const IMAGE_RE = /\.(?:jpe?g|png|webp)$/

/** 文件分类；不收录的文件返回 undefined。参数须是小写文件名。 */
export function fileKindOf(lowerName: string): LibraryFileKind | undefined {
  if (VIDEO_EXTENSIONS.has(extname(lowerName))) return 'video'
  if (lowerName.endsWith('.nfo')) return 'nfo'
  if (IMAGE_RE.test(lowerName)) return 'image'
  return undefined
}

/** 名字本身就该跳过（隐藏项、`__` 开头的临时项、黑名单）。参数须是小写名。 */
export function isIgnoredName(lowerName: string): boolean {
  return (
    lowerName.startsWith('.') ||
    lowerName.startsWith('__') ||
    IGNORED_NAMES.has(lowerName)
  )
}

/** 是否收录该目录项（媒体文件、旁挂 nfo / 图片，或可下钻的目录）。 */
export function isWantedEntry(
  lowerName: string,
  isDirectory: boolean,
  isFile: boolean
): boolean {
  if (isDirectory) return true
  return isFile && fileKindOf(lowerName) !== undefined
}

/** 路径键是否大小写不敏感（Windows）。 */
const CASE_INSENSITIVE = process.platform === 'win32'

/**
 * 路径键：正斜杠、去掉结尾斜杠，Windows 下转小写（远程源上的路径区分大小写，不转）。
 * 数据库唯一索引和子树前缀查询都基于它，任何写入前都要先转换。
 */
export function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return CASE_INSENSITIVE && !isRemotePath(normalized)
    ? normalized.toLowerCase()
    : normalized
}

/** 路径键的父目录键；已经是根时返回空串。 */
export function parentKey(key: string): string {
  return key.slice(0, Math.max(0, key.lastIndexOf('/')))
}

/**
 * 子树范围：`key/` ≤ path < `key0`（'0' 是 '/' 的下一个字符），
 * 用 path 上的唯一索引做范围扫描，不需要 LIKE。
 */
export function subtreeRange(key: string): [lower: string, upper: string] {
  return [`${key}/`, `${key}0`]
}
