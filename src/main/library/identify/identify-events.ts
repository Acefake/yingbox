/**
 * 识别结果的事件推送：把一批条目变化按所属媒体库拆成 items-changed 事件推给订阅方。
 * 识别模块与 AI 识别兜底共用。
 *
 * 识别后和别的文件夹里的同一作品合并了的条目（同 merge_key，见 catalog/merge）在海报墙上会消失或换代表，
 * 这类条目额外记进 added，订阅方按结构变化重载可见区间，而不是原地刷新那一页。
 */
import type { LibraryEvent } from '../../../shared/library/ipc'
import type { ItemChanges } from '../catalog/catalog-store'
import type { LibraryDb } from '../db/database'
import { itemsChangedEvents } from './identify-rules'

/** 按媒体库拆分变化并推送 items-changed；没有变化时什么都不做。 */
export function emitItemChanges(
  db: LibraryDb,
  emit: (event: LibraryEvent) => void,
  changes: ItemChanges
): void {
  if (changes.empty) return
  const ids = [...changes.added, ...changes.updated]
  const libraryOf = new Map<number, number>()
  const merged = new Set<number>()
  for (const row of db
    .prepare(
      `SELECT i.id, i.library_id, i.merge_key IS NOT NULL AND EXISTS (
         SELECT 1 FROM media_items o WHERE o.merge_key = i.merge_key AND o.id <> i.id
       ) AS merged
       FROM media_items i WHERE i.id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(ids))) {
    libraryOf.set(Number(row.id), Number(row.library_id))
    if (Number(row.merged)) merged.add(Number(row.id))
  }
  for (const event of itemsChangedEvents(changes, libraryOf)) {
    if (event.type === 'items-changed' && merged.size) {
      const extra = event.updated.filter(
        id => merged.has(id) && !event.added.includes(id)
      )
      event.added.push(...extra)
    }
    emit(event)
  }
}
