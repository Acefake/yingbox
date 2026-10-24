/**
 * 识别结果的事件推送：把一批条目变化按所属媒体库拆成 items-changed 事件推给订阅方。
 * 识别模块与 AI 识别兜底共用。
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
  for (const row of db
    .prepare(
      'SELECT id, library_id FROM media_items WHERE id IN (SELECT value FROM json_each(?))'
    )
    .all(JSON.stringify(ids))) {
    libraryOf.set(Number(row.id), Number(row.library_id))
  }
  for (const event of itemsChangedEvents(changes, libraryOf)) emit(event)
}
