import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

const locks = new Map<string, Promise<void>>()
const keyFor = (value: string): string => {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export async function withPathLocks<T>(paths: string[], action: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths.map(keyFor))].sort()
  const previous = keys.map(key => locks.get(key) ?? Promise.resolve())
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  for (const key of keys) locks.set(key, current)
  await Promise.all(previous)
  try {
    return await action()
  } finally {
    release()
    for (const key of keys) if (locks.get(key) === current) locks.delete(key)
  }
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.lstat(filePath); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Replace a file while retaining the prior content until the new file is committed. */
export async function replaceFile(source: string, destination: string): Promise<void> {
  const backup = `${destination}.${randomUUID()}.backup`
  const hadDestination = await exists(destination)
  if (hadDestination && !(await fs.lstat(destination)).isFile()) {
    throw new Error('目标不是普通文件')
  }
  let backedUp = false
  try {
    if (hadDestination) {
      await fs.rename(destination, backup)
      backedUp = true
    }
    await fs.rename(source, destination)
  } catch (error) {
    if (backedUp) {
      try {
        await fs.rename(backup, destination)
      } catch {
        throw new Error(`替换失败，原文件保留在 ${backup}: ${(error as Error).message}`)
      }
    }
    throw error
  }
  if (backedUp) await fs.unlink(backup).catch(error => console.warn(`旧文件备份保留在 ${backup}`, error))
}

export async function movePath(source: string, destination: string, replace = false): Promise<void> {
  const src = path.resolve(source)
  const dest = path.resolve(destination)
  if (keyFor(src) === keyFor(dest)) { await fs.access(src); return }
  await withPathLocks([src, dest], async () => {
    const sourceStats = await fs.lstat(src)
    const relative = path.relative(src, dest)
    if (sourceStats.isDirectory() && relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
      throw new Error('不能将目录移动到自身的子目录')
    }
    const targetExists = await exists(dest)
    if (targetExists && !replace) throw new Error(`目标已存在: ${dest}`)
    if (targetExists && (!sourceStats.isFile() || !(await fs.lstat(dest)).isFile())) {
      throw new Error('仅支持替换普通文件')
    }
    const backup = `${dest}.${randomUUID()}.backup`
    let backedUp = false
    let committed = false
    try {
      if (targetExists) { await fs.rename(dest, backup); backedUp = true }
      try {
        await fs.rename(src, dest)
        committed = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        // Copy into a sibling staging path before exposing the new destination.
        const staging = `${dest}.${randomUUID()}.partial`
        try {
          await fs.cp(src, staging, { recursive: true, force: false, errorOnExist: true })
          await fs.rename(staging, dest)
          committed = true
          await fs.rm(src, { recursive: sourceStats.isDirectory() })
        } finally {
          await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        }
      }
    } catch (error) {
      if (backedUp && !committed) {
        try { await fs.rename(backup, dest) } catch {
          throw new Error(`移动失败，原文件保留在 ${backup}: ${(error as Error).message}`)
        }
      }
      throw error
    }
    if (backedUp) {
      // A cleanup failure must not misreport a committed move as a failed move.
      await fs.unlink(backup).catch(error => console.warn(`旧文件备份保留在 ${backup}`, error))
    }
  })
}

export async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${randomUUID()}.partial`
    try {
      await fs.writeFile(temporary, content, { flag: 'wx' })
      await replaceFile(temporary, filePath)
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
  })
}
