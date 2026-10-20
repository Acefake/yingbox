import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

export interface MediaEntry {
  name: string
  path: string
  size: number
  mtime: number
  isDirectory: boolean
  isFile: boolean
}

/** Compact previous-index entry used for incremental scan / dir-mtime short-circuit */
export interface MediaIndexEntry {
  path: string
  mtime: number
  size: number
  name?: string
  isDirectory?: boolean
  isFile?: boolean
}

const videoExtensions = new Set([
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
const ignored = new Set([
  '.actors',
  '@eadir',
  '$recycle.bin',
  'system volume information',
])

/** 与 String#localeCompare 默认行为一致的排序器，复用实例比逐次 localeCompare 快得多。 */
const pathCollator = new Intl.Collator()

/** 同时处理的目录数；目录内的 stat 也并发发起。 */
const DIRECTORY_CONCURRENCY = 16

const normPath = (p: string): string =>
  p.replace(/\\/g, '/').replace(/\/+$/, '')
const pathKey = (p: string): string =>
  process.platform === 'win32' ? normPath(p).toLowerCase() : normPath(p)
const parentKey = (key: string): string => key.slice(0, key.lastIndexOf('/'))

const toMediaEntry = (entry: MediaIndexEntry): MediaEntry => ({
  name: entry.name || basename(entry.path),
  path: entry.path,
  size: entry.size,
  mtime: entry.mtime,
  isDirectory: Boolean(entry.isDirectory),
  isFile:
    entry.isFile !== undefined ? Boolean(entry.isFile) : !entry.isDirectory,
})

/** 是否收录该目录项（媒体文件、旁挂 nfo/图片，或可下钻的目录）。 */
function isWanted(
  lowerName: string,
  isDirectory: boolean,
  isFile: boolean
): boolean {
  if (isDirectory) return true
  if (!isFile) return false
  return (
    videoExtensions.has(extname(lowerName)) ||
    lowerName.endsWith('.nfo') ||
    /\.(jpe?g|png|webp)$/i.test(lowerName)
  )
}

/**
 * 递归扫描媒体库目录。
 *
 * 传入 `previousIndex` 时做增量扫描：目录 mtime 与旧索引一致，说明它的**直接子项**列表
 * 没变，于是跳过 readdir、复用旧索引里的直接文件子项；但子目录仍然逐个下钻，因为目录
 * mtime 不反映孙子层的变化。旧索引按父目录建表，复用一个目录的代价只和它的直接子项数
 * 成正比，整体是 O(N)。
 *
 * 结果不含根目录自身，按路径排序。
 */
export async function scanMediaDirectory(
  root: string,
  previousIndex?: MediaIndexEntry[]
): Promise<{ data: MediaEntry[]; warnings: string[]; reused: number }> {
  const data: MediaEntry[] = []
  const warnings: string[] = []
  let reused = 0

  const rootResolved = resolve(root)
  const prevByPath = new Map<string, MediaIndexEntry>()
  const childrenByParent = new Map<string, MediaIndexEntry[]>()
  for (const entry of previousIndex ?? []) {
    const key = pathKey(entry.path)
    prevByPath.set(key, entry)
    const parent = parentKey(key)
    const siblings = childrenByParent.get(parent)
    if (siblings) siblings.push(entry)
    else childrenByParent.set(parent, [entry])
  }

  /** 复用目录的旧直接子项：文件直接收下，子目录交给调用方继续下钻。 */
  const reuseDirectChildren = (dirKey: string): string[] => {
    const subdirs: string[] = []
    for (const child of childrenByParent.get(dirKey) ?? []) {
      if (child.isDirectory) {
        subdirs.push(child.path)
      } else {
        data.push(toMediaEntry(child))
        reused++
      }
    }
    return subdirs
  }

  /** readdir 失败时的软回退：复用整棵旧子树（不含目录自身）。 */
  const reuseSubtree = (dirKey: string): void => {
    const stack = [dirKey]
    while (stack.length) {
      for (const child of childrenByParent.get(stack.pop()!) ?? []) {
        data.push(toMediaEntry(child))
        reused++
        if (child.isDirectory) stack.push(pathKey(child.path))
      }
    }
  }

  /** 读取一个目录，返回需要继续下钻的子目录。 */
  const readDirectory = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const subdirs: string[] = []
    const files: string[] = []
    for (const entry of entries) {
      const name = entry.name.toLowerCase()
      if (
        name.startsWith('.') ||
        name.startsWith('__') ||
        ignored.has(name) ||
        entry.isSymbolicLink() ||
        !isWanted(name, entry.isDirectory(), entry.isFile())
      ) {
        continue
      }
      const filePath = join(directory, entry.name)
      if (entry.isDirectory()) subdirs.push(filePath)
      else files.push(filePath)
    }
    await Promise.all(
      files.map(async filePath => {
        try {
          const stats = await stat(filePath)
          data.push({
            name: basename(filePath),
            path: filePath,
            size: stats.size,
            mtime: stats.mtimeMs,
            isDirectory: false,
            isFile: true,
          })
        } catch (error) {
          warnings.push(`${filePath}: ${(error as Error).message}`)
        }
      })
    )
    return subdirs
  }

  /** 处理一个非根目录：记录目录自身，按 mtime 决定复用还是 readdir。 */
  const visit = async (directory: string): Promise<string[]> => {
    const dirKey = pathKey(directory)
    let dirStats
    try {
      dirStats = await stat(directory)
    } catch (error) {
      warnings.push(`${directory}: ${(error as Error).message}`)
      return []
    }
    data.push({
      name: basename(directory),
      path: directory,
      size: 0,
      mtime: dirStats.mtimeMs,
      isDirectory: true,
      isFile: false,
    })

    const prev = prevByPath.get(dirKey)
    if (prev?.isDirectory && prev.mtime === dirStats.mtimeMs) {
      return reuseDirectChildren(dirKey)
    }
    try {
      return await readDirectory(directory)
    } catch (error) {
      warnings.push(`${directory}: ${(error as Error).message}`)
      reuseSubtree(dirKey)
      return []
    }
  }

  // 根目录总是 readdir，失败直接抛出。
  const queue = await readDirectory(rootResolved)
  await new Promise<void>((done, fail) => {
    let active = 0
    const pump = (): void => {
      while (active < DIRECTORY_CONCURRENCY && queue.length) {
        active++
        visit(queue.pop()!).then(subdirs => {
          active--
          queue.push(...subdirs)
          pump()
        }, fail)
      }
      if (active === 0 && queue.length === 0) done()
    }
    pump()
  })

  return {
    data: data.sort((a, b) => pathCollator.compare(a.path, b.path)),
    warnings,
    reused,
  }
}
