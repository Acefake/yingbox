/**
 * 一个目录的列表与快照对比（本地遍历 walk.ts 与远程遍历 remote-walk.ts 共用）：
 * 得到这个目录的文件增删改、哪些子目录是新出现的、哪些已知子目录消失了。
 */
import type { DirChange, RemovedDir, ScanSnapshot, ScannedFile } from './types'

/** 对比结果。 */
export interface DirDiff {
  /** 需要写回的变化；目录 mtime 与文件都没变时为 null。 */
  change: DirChange | null
  /** 列表里的子目录键 → 快照里是否已有。 */
  knownSubdirs: Map<string, boolean>
  /** 快照里有、列表里没有的子目录（文件留空，遍历结束后分片读）。 */
  removedDirs: RemovedDir[]
}

/**
 * 对比一个目录。dir 是本次看到的目录记录（mtime 可能已换成 RACY 哨兵），
 * prevMtime 是快照里的 mtime（快照里没有时 undefined），subdirKeys 是列表里子目录的路径键。
 */
export function diffDirectory(
  snapshot: ScanSnapshot,
  dir: DirChange['dir'],
  prevMtime: number | undefined,
  files: ScannedFile[],
  subdirKeys: string[]
): DirDiff {
  const oldFiles = new Map(snapshot.filesIn(dir.key).map(f => [f.key, f]))
  const change: DirChange = { dir, added: [], changed: [], removed: [] }
  for (const file of files) {
    const old = oldFiles.get(file.key)
    if (!old) change.added.push(file)
    else {
      oldFiles.delete(file.key)
      if (old.size !== file.size || old.mtime !== file.mtime) {
        change.changed.push({ ...file, id: old.id })
      }
    }
  }
  change.removed.push(...oldFiles.values())

  const known = new Map(snapshot.childDirs(dir.key).map(d => [d.key, d]))
  const knownSubdirs = new Map<string, boolean>()
  for (const key of subdirKeys) knownSubdirs.set(key, known.delete(key))
  const removedDirs = [...known.values()].map(gone => ({
    key: gone.key,
    files: [],
  }))

  const unchanged =
    prevMtime === dir.mtime &&
    change.added.length === 0 &&
    change.changed.length === 0 &&
    change.removed.length === 0
  return { change: unchanged ? null : change, knownSubdirs, removedDirs }
}
