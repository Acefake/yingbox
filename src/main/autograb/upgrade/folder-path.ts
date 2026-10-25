/**
 * 洗版「存到同目录」：本地挂载路径（CloudDrive2）→ 115 文件夹 cid。
 *
 * - 设置里填了挂载根目录（library.notify.mountRoot）：本地目录去掉它就是 115 路径，从根逐级找；
 * - 没填：列 115 根目录，本地路径里第一段和根目录下某个文件夹同名的地方当作 115 路径开头，再逐级找。
 * 每一级一次列目录（经闸门）；找不到返回 null，由用户在界面上选文件夹。
 */
import type { Pan115DirListing } from '../../../shared/contract/pan115'

/** 路径分段：同时认 / 和 \，去掉盘符与空段 */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(s => s && !/^[a-z]:$/i.test(s))
}

/**
 * 本地目录在挂载根目录下的相对分段；不在它下面返回 null。
 * 比较时 Windows 盘符路径不分大小写。
 */
export function underMount(
  localDir: string,
  mountRoot: string
): string[] | null {
  const dir = pathSegments(localDir)
  const root = pathSegments(mountRoot)
  if (!root.length || dir.length < root.length) return null
  const fold = /^[a-z]:/i.test(localDir)
  const same = (a: string, b: string): boolean =>
    fold ? a.toLowerCase() === b.toLowerCase() : a === b
  return root.every((seg, i) => same(seg, dir[i]))
    ? dir.slice(root.length)
    : null
}

/** 解析要的 115 能力（列一层目录，经闸门） */
export type ListDirs = (cid: string) => Promise<Pan115DirListing>

async function walk(
  segments: string[],
  start: string,
  dirs: ListDirs
): Promise<string | null> {
  let cid = start
  for (const name of segments) {
    const listing = await dirs(cid)
    const next = listing.dirs.find(d => d.name === name)
    if (!next) return null
    cid = next.cid
  }
  return cid
}

/**
 * 本地目录对应的 115 文件夹 cid。
 * @param mountRoot 挂载根目录；空串表示没填
 */
export async function resolveFolderCid(
  localDir: string,
  mountRoot: string,
  dirs: ListDirs
): Promise<string | null> {
  if (mountRoot) {
    const rest = underMount(localDir, mountRoot)
    if (rest) return rest.length ? walk(rest, '0', dirs) : '0'
  }
  const segments = pathSegments(localDir)
  const root = await dirs('0')
  const names = new Set(root.dirs.map(d => d.name))
  const start = segments.findIndex(s => names.has(s))
  if (start < 0) return null
  const first = root.dirs.find(d => d.name === segments[start])!
  return walk(segments.slice(start + 1), first.cid, dirs)
}

/** 文件所在目录（同时认 / 和 \） */
export const dirOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

/** 文件名 */
export const baseOf = (path: string): string =>
  path.split(/[\\/]/).pop() ?? path

/** 目录 + 文件名：目录只用 \ 分隔时（Windows）也用 \ */
export const joinPath = (dir: string, name: string): string =>
  `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`
