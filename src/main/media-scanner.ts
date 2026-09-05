import { readdir, stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'

export interface MediaEntry {
  name: string; path: string; size: number; mtime: number; isDirectory: boolean; isFile: boolean
}

const videoExtensions = new Set(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.rmvb'])
const ignored = new Set(['.actors', '@eadir', '$recycle.bin', 'system volume information'])

export async function scanMediaDirectory(root: string): Promise<{ data: MediaEntry[]; warnings: string[] }> {
  const data: MediaEntry[] = []
  const warnings: string[] = []
  const directories = [resolve(root)]
  while (directories.length) {
    const batch = directories.splice(0, 4)
    await Promise.all(batch.map(async directory => {
      try {
        const entries = await readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
          const name = entry.name.toLowerCase()
          if (name.startsWith('.') || name.startsWith('__') || ignored.has(name) || entry.isSymbolicLink()) continue
          const filePath = join(directory, entry.name)
          const isVideo = videoExtensions.has(extname(name))
          const isSidecar = name.endsWith('.nfo') || /\.(jpe?g|png|webp)$/i.test(name)
          if (!entry.isDirectory() && (!entry.isFile() || (!isVideo && !isSidecar))) continue
          try {
            const stats = await stat(filePath)
            data.push({ name: entry.name, path: filePath, size: stats.isFile() ? stats.size : 0,
              mtime: stats.mtimeMs, isDirectory: stats.isDirectory(), isFile: stats.isFile() })
            if (entry.isDirectory()) directories.push(filePath)
          } catch (error) { warnings.push(`${filePath}: ${(error as Error).message}`) }
        }
      } catch (error) {
        if (directory === resolve(root)) throw error
        warnings.push(`${directory}: ${(error as Error).message}`)
      }
    }))
  }
  return { data: data.sort((a, b) => a.path.localeCompare(b.path)), warnings }
}
