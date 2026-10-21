/**
 * gfriends 头像索引的文件持久化（GfriendsStore 实现）：存在片库数据目录下的一个 JSON 文件，
 * 重启后不必重新下载约 6 MB 的 Filetree.json。写入走「临时文件 + 改名」，中途崩溃不会留下半截文件。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  GfriendsSnapshot,
  GfriendsStore,
} from '../providers/jav/actors/sources/gfriends'

/** 快照是否像样：有抓取时间和条目对象。 */
function isSnapshot(value: unknown): value is GfriendsSnapshot {
  const v = value as Partial<GfriendsSnapshot> | null
  return (
    !!v &&
    typeof v.fetchedAt === 'number' &&
    !!v.entries &&
    typeof v.entries === 'object'
  )
}

/** 用一个 JSON 文件持久化 gfriends 索引；文件不存在或损坏时 load 返回 null。 */
export function createFileGfriendsStore(path: string): GfriendsStore {
  return {
    async load() {
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        return isSnapshot(value) ? value : null
      } catch {
        return null
      }
    },
    async save(snapshot) {
      const temp = `${path}.${randomUUID()}.partial`
      await mkdir(dirname(path), { recursive: true })
      try {
        await writeFile(temp, JSON.stringify(snapshot))
        await rename(temp, path)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
    },
  }
}
