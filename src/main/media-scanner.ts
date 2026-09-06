import { readdir, stat } from 'node:fs/promises'
import { join, extname, resolve, basename } from 'node:path'

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
const ignored = new Set(['.actors', '@eadir', '$recycle.bin', 'system volume information'])

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const pathKey = (p: string): string =>
  process.platform === 'win32' ? normPath(p).toLowerCase() : normPath(p)

/**
 * Recursively scan a media library.
 * When `previousIndex` is provided, directories whose mtime is unchanged vs the
 * cache skip readdir and reuse cached descendants (big win on Windows/OneDrive).
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
  if (previousIndex?.length) {
    for (const entry of previousIndex) {
      prevByPath.set(pathKey(entry.path), entry)
    }
  }

  /** Collect all cached descendants under a directory (not including the dir itself). */
  const collectCachedDescendants = (dirNorm: string): MediaEntry[] => {
    const prefix = pathKey(dirNorm) + '/'
    const out: MediaEntry[] = []
    for (const [p, entry] of prevByPath) {
      if (!p.startsWith(prefix)) continue
      out.push({
        name: entry.name || basename(entry.path),
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        isDirectory: Boolean(entry.isDirectory),
        isFile: entry.isFile !== undefined ? Boolean(entry.isFile) : !entry.isDirectory,
      })
    }
    return out
  }

  const directories = [rootResolved]
  while (directories.length) {
    const batch = directories.splice(0, 4)
    await Promise.all(
      batch.map(async directory => {
        const dirNorm = pathKey(directory)
        try {
          // Directory mtime short-circuit (skip root itself — always readdir root)
          if (directory !== rootResolved && prevByPath.size > 0) {
            try {
              const dirStats = await stat(directory)
              const prev = prevByPath.get(dirNorm) // dirNorm already pathKey'd
              if (
                prev &&
                prev.isDirectory &&
                prev.mtime === dirStats.mtimeMs
              ) {
                const cached = collectCachedDescendants(dirNorm)
                data.push(...cached)
                reused += cached.length
                return
              }
            } catch {
              // fall through to readdir
            }
          }

          const entries = await readdir(directory, { withFileTypes: true })
          for (const entry of entries) {
            const name = entry.name.toLowerCase()
            if (
              name.startsWith('.') ||
              name.startsWith('__') ||
              ignored.has(name) ||
              entry.isSymbolicLink()
            ) {
              continue
            }
            const filePath = join(directory, entry.name)
            const isVideo = videoExtensions.has(extname(name))
            const isSidecar =
              name.endsWith('.nfo') || /\.(jpe?g|png|webp)$/i.test(name)
            if (
              !entry.isDirectory() &&
              (!entry.isFile() || (!isVideo && !isSidecar))
            ) {
              continue
            }
            try {
              const stats = await stat(filePath)
              data.push({
                name: entry.name,
                path: filePath,
                size: stats.isFile() ? stats.size : 0,
                mtime: stats.mtimeMs,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
              })
              if (entry.isDirectory()) directories.push(filePath)
            } catch (error) {
              warnings.push(`${filePath}: ${(error as Error).message}`)
            }
          }
        } catch (error) {
          if (directory === rootResolved) throw error
          warnings.push(`${directory}: ${(error as Error).message}`)
          // If readdir failed but we have cache, reuse it as soft fallback
          if (prevByPath.size > 0) {
            const cached = collectCachedDescendants(dirNorm)
            if (cached.length) {
              data.push(...cached)
              reused += cached.length
            }
          }
        }
      })
    )
  }

  // Deduplicate by normalized path (short-circuit reuse + live scan can overlap
  // if a parent was rescanned while a child was also queued — shouldn't happen
  // with short-circuit return, but keep safe)
  const seen = new Set<string>()
  const deduped: MediaEntry[] = []
  for (const item of data) {
    const key = pathKey(item.path)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return {
    data: deduped.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
    reused,
  }
}

