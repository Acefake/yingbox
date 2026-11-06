/** 纠正条目分类时串行修改媒体库并通知订阅方。 */
import {
  LibraryError,
  type LibraryEvent,
  type LibraryItemSummary,
  type LibraryRpcMap,
} from '../../../shared/library/ipc'
import type { LibraryDb } from '../db/database'
import type { KeyedMutex } from '../jobs/keyed-mutex'
import type { LibraryRecord } from '../libraries/library-store'
import type { CatalogStore } from './catalog-store'
import type { CatalogQuery } from './query'
import { reclassifyItem } from './reclassify'
interface Context {
  db: LibraryDb
  catalog: CatalogStore
  query: CatalogQuery
  locks: KeyedMutex<number>
  matching: ReadonlySet<number>
  identifying(): boolean
  library(id: number): LibraryRecord
  emit(event: LibraryEvent): void
}
/** 在媒体库锁内纠正分类，识别进行中时拒绝修改。 */
export async function reclassifyCommand(
  request: LibraryRpcMap['reclassifyItem']['params'],
  ctx: Context
): Promise<LibraryItemSummary> {
  const item = ctx.query.summary(request.itemId)
  if (!item) throw new Error('条目不存在')
  return ctx.locks.run(item.libraryId, async () => {
    if (ctx.matching.has(item.id) || ctx.identifying()) {
      throw new LibraryError('conflict', '识别任务正在进行，请完成后再纠正类型')
    }
    reclassifyItem(
      ctx.db,
      ctx.catalog,
      ctx.library(item.libraryId),
      item.id,
      request.kind
    )
    ctx.emit({
      type: 'items-changed',
      libraryId: item.libraryId,
      added: [],
      updated: [],
      removed: [],
      reset: true,
    })
    return ctx.query.summary(item.id)!
  })
}
