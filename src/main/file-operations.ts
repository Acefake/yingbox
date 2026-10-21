import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

const locks = new Map<string, Promise<void>>()
const keyFor = (value: string): string => {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function withPathLocks<T>(
  paths: string[],
  action: () => Promise<T>
): Promise<T> {
  const keys = [...new Set(paths.map(keyFor))].sort()
  const previous = keys.map(key => locks.get(key) ?? Promise.resolve())
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
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
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Replace a file while retaining the prior content until the new file is committed. */
async function replaceFile(
  source: string,
  destination: string
): Promise<void> {
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
        throw new Error(
          `替换失败，原文件保留在 ${backup}: ${(error as Error).message}`
        )
      }
    }
    throw error
  }
  if (backedUp)
    await fs
      .unlink(backup)
      .catch(error => console.warn(`旧文件备份保留在 ${backup}`, error))
}

/** 原子写文件：先写同目录临时文件，再替换目标（同一路径的写入串行）。 */
export async function atomicWrite(
  filePath: string,
  content: string | Uint8Array
): Promise<void> {
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
