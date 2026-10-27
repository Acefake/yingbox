/**
 * 最近使用的 115 转存文件夹：最多 {@link MAX_RECENT_FOLDERS} 个，新用的排最前，同一 cid 只留一条（名字取最新）。
 * 存在 localStorage（经 utils/storage），是数据不是设置；读到坏数据时丢掉坏的那条。
 */
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'
import { readStoredArray, saveStoredArray } from '@/utils/storage'

/** 最多记几个 */
export const MAX_RECENT_FOLDERS = 5
/** localStorage 键 */
export const RECENT_FOLDERS_KEY = 'netdisk.recentFolders'

const isFolder = (value: unknown): boolean => {
  const item = value as Partial<TargetFolder> | null
  return (
    !!item &&
    typeof item.cid === 'string' &&
    /^\d{1,32}$/.test(item.cid) &&
    typeof item.name === 'string'
  )
}

/** 把 folder 记到最前（纯函数，不改入参） */
export function pushRecentFolder(
  list: readonly TargetFolder[],
  folder: TargetFolder,
  max = MAX_RECENT_FOLDERS
): TargetFolder[] {
  const entry = { cid: folder.cid, name: folder.name }
  return [entry, ...list.filter(item => item.cid !== folder.cid)].slice(0, max)
}

/** 读最近使用 */
export function readRecentFolders(): TargetFolder[] {
  return readStoredArray<TargetFolder>(RECENT_FOLDERS_KEY, isFolder)
    .slice(0, MAX_RECENT_FOLDERS)
    .map(({ cid, name }) => ({ cid, name }))
}

/** 记一次使用，返回新列表 */
export function rememberRecentFolder(folder: TargetFolder): TargetFolder[] {
  const next = pushRecentFolder(readRecentFolders(), folder)
  saveStoredArray(RECENT_FOLDERS_KEY, next)
  return next
}
