/**
 * 远程源（WebDAV / Alist）的增量遍历：PROPFIND Depth: 1 逐层列目录，产出和本地遍历（walk.ts）
 * 同样形状的差异，之后的移动识别、分片写库、条目归并完全复用 scan-library。
 *
 * - 增量：目录版本戳（etag / getlastmodified，见 remote-rules）没变就不列它，只对已知子目录逐个取
 *   版本戳；列父目录时已经拿到了子目录的版本戳，这些子目录不再单独请求；
 * - 并发：同时最多 concurrency 个请求（默认 4，NAS 和 Alist 后面的网盘都扛得住），单次请求有超时；
 * - 安全：根目录列不到直接抛错（NAS 掉线不能当成“全删了”）；非根目录失败只告警、保留旧记录。
 * 远程源不监听变化，只在手动扫描（或以后的定时扫描）时调用。
 */
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import type { DavClient } from '../../../shared/webdav/client'
import { DavError } from '../../../shared/webdav/client'
import { type DavEntry, splitListing } from '../../../shared/webdav/propfind'
import { parseRemotePath, remotePath } from '../../../shared/webdav/remote-path'
import { diffDirectory } from './diff-dir'
import { canReuseDir, dirStamp, fileMtime } from './remote-rules'
import { fileKindOf, isIgnoredName, parentKey, pathKey } from './rules'
import type { ScanDiff, ScanSnapshot, ScannedFile } from './types'
import { SCAN_SLICE_MS } from './walk'

/** 远程遍历参数。 */
export interface RemoteWalkOptions {
  /** 不走版本戳短路，所有目录都列。 */
  full?: boolean
  /** 只重读这些目录（库里登记的远程路径写法）；新出现的子目录完整下钻，已知子目录不下钻。 */
  scope?: string[]
  /** 同时进行的请求数，默认 4。 */
  concurrency?: number
  signal?: AbortSignal
  /** 刚改过的修改时间不可信的时间窗（毫秒），默认 3000。 */
  racyWindowMs?: number
  /** 同步读快照最多连续占用事件循环多久（毫秒），默认 SCAN_SLICE_MS。 */
  sliceMs?: number
}

/** 待处理目录：stamp 是列父目录时拿到的版本戳（没有时按需取）。 */
interface Task {
  path: string
  stamp?: number
  force: boolean
  descendKnown: boolean
}

/** 对照快照遍历远程媒体库，返回差异。root 是库里登记的远程路径（yingbox-dav://<id>/<path>）。 */
export async function walkRemoteLibrary(
  root: string,
  snapshot: ScanSnapshot,
  client: DavClient,
  options: RemoteWalkOptions = {}
): Promise<ScanDiff> {
  const parsedRoot = parseRemotePath(root)
  if (!parsedRoot) throw new Error(`不是远程媒体库路径：${root}`)
  const { sourceId } = parsedRoot
  const rootKey = pathKey(remotePath(sourceId, parsedRoot.path))
  const racyBefore = Date.now() - (options.racyWindowMs ?? 3000)
  const full = options.full ?? false
  const { signal } = options
  const diff: ScanDiff = {
    dirChanges: [],
    removedDirs: [],
    warnings: [],
    stats: { dirsVisited: 0, dirsReused: 0, filesStatted: 0 },
  }
  const visited = new Set<string>()
  const display = (path: string): string => remotePath(sourceId, path)

  /** 子目录任务：快照里的已知目录换回远程路径。 */
  const knownChildren = (key: string): Task[] =>
    snapshot.childDirs(key).flatMap(d => {
      const parsed = parseRemotePath(d.displayPath)
      return parsed
        ? [{ path: parsed.path, force: false, descendKnown: true }]
        : []
    })

  /** 请求失败：根目录抛出，404 静默（父目录列表负责记删除），其他告警。 */
  const failed = (path: string, key: string, error: unknown): Task[] => {
    if (signal?.aborted) throw signal.reason
    if (key === rootKey) throw error
    if (!(error instanceof DavError && error.code === 'not-found'))
      diff.warnings.push(`${display(path)}: ${(error as Error).message}`)
    return []
  }

  const visit = async (task: Task): Promise<Task[]> => {
    const displayPath = display(task.path)
    const key = pathKey(displayPath)
    if (visited.has(key)) return []
    visited.add(key)
    diff.stats.dirsVisited++
    const prev = snapshot.getDir(key)
    const force = task.force || full

    let stamp = task.stamp
    if (stamp === undefined && !force && prev) {
      try {
        const [self] = await client.propfind(task.path, 0, signal)
        stamp = dirStamp(self, racyBefore)
      } catch (error) {
        return failed(task.path, key, error)
      }
    }
    if (stamp !== undefined && canReuseDir(prev?.mtime, stamp, force)) {
      diff.stats.dirsReused++
      return task.descendKnown ? knownChildren(key) : []
    }

    let entries: DavEntry[]
    try {
      entries = await client.propfind(task.path, 1, signal)
    } catch (error) {
      return failed(task.path, key, error)
    }
    const { self, children } = splitListing(entries, task.path)
    const files: ScannedFile[] = []
    const subdirs: Task[] = []
    for (const entry of children) {
      const lower = entry.name.toLowerCase()
      if (!entry.name || isIgnoredName(lower)) continue
      if (entry.isDir) {
        subdirs.push({
          path: entry.path,
          stamp: dirStamp(entry, racyBefore),
          force: false,
          descendKnown: true,
        })
        continue
      }
      const kind = fileKindOf(lower)
      if (!kind) continue
      const filePath = display(entry.path)
      files.push({
        key: pathKey(filePath),
        displayPath: filePath,
        dir: key,
        name: entry.name,
        kind,
        size: entry.size,
        mtime: fileMtime(entry),
      })
    }
    diff.stats.filesStatted += files.length
    const subKeys = subdirs.map(sub => pathKey(display(sub.path)))
    const result = diffDirectory(
      snapshot,
      {
        key,
        displayPath,
        parent: key === rootKey ? null : parentKey(key),
        mtime: dirStamp(self, racyBefore),
      },
      prev?.mtime,
      files,
      subKeys
    )
    diff.removedDirs.push(...result.removedDirs)
    if (result.change) diff.dirChanges.push(result.change)
    return subdirs.filter(
      (_, i) => task.descendKnown || !result.knownSubdirs.get(subKeys[i])
    )
  }

  const queue: Task[] = []
  const scoped = (options.scope ?? []).flatMap(dir => {
    const parsed = parseRemotePath(dir)
    if (!parsed || parsed.sourceId !== sourceId) return []
    const key = pathKey(display(parsed.path))
    return key === rootKey || key.startsWith(`${rootKey}/`) ? [parsed.path] : []
  })
  if (scoped.length) {
    for (const path of scoped)
      queue.push({ path, force: true, descendKnown: false })
  } else {
    queue.push({ path: parsedRoot.path, force: true, descendKnown: true })
  }

  const concurrency = Math.max(1, options.concurrency ?? 4)
  await new Promise<void>((done, fail) => {
    let active = 0
    let stopped = false
    const pump = (): void => {
      if (stopped) return
      if (signal?.aborted) {
        stopped = true
        fail(signal.reason)
        return
      }
      while (active < concurrency && queue.length) {
        const task = queue.pop()!
        active++
        visit(task).then(
          next => {
            active--
            queue.push(...next)
            pump()
          },
          error => {
            stopped = true
            fail(error)
          }
        )
      }
      if (active === 0 && queue.length === 0) done()
    }
    pump()
  })

  const sliceMs = options.sliceMs ?? SCAN_SLICE_MS
  let deadline = performance.now() + sliceMs
  for (const gone of diff.removedDirs) {
    gone.files = snapshot.filesUnder(gone.key)
    if (performance.now() >= deadline) {
      await yieldToLoop()
      signal?.throwIfAborted()
      deadline = performance.now() + sliceMs
    }
  }
  return diff
}
