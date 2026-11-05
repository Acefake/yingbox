import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  LibraryError,
  type TrashFileTarget,
  type TrashFilesResult,
} from '../../../shared/library/ipc'

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  )
}

/** 返回库内可回收的普通文件。拒绝越界路径、符号链接及扫描后发生变化的文件。 */
export async function checkedTrashPath(
  root: string,
  file: TrashFileTarget
): Promise<string> {
  if (!isAbsolute(root) || !isAbsolute(file.path) || !inside(root, file.path))
    throw new LibraryError('conflict', '文件不在媒体库目录内')

  const [realRoot, parent] = await Promise.all([
    realpath(root),
    realpath(dirname(file.path)),
  ])
  const path = join(parent, basename(file.path))
  if (!inside(realRoot, path))
    throw new LibraryError('conflict', '文件不在媒体库目录内')

  const stat = await lstat(path)
  if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtime)
    throw new LibraryError('conflict', '磁盘上的文件已变化，请重新扫描媒体库')
  return path
}

/** 先校验整批，再逐个核对并回收，保留成功前缀用于同步目录索引。 */
export async function trashFiles(
  targets: ReadonlyArray<{ root: string; file: TrashFileTarget }>,
  trash: (path: string) => Promise<void>
): Promise<TrashFilesResult> {
  for (const { root, file } of targets) await checkedTrashPath(root, file)
  let moved = 0
  for (const { root, file } of targets) {
    try {
      await trash(await checkedTrashPath(root, file))
      moved++
    } catch (error) {
      return {
        moved,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return { moved }
}
