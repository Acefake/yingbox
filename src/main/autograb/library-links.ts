/** 可选媒体库关联只在 TMDB 身份仍匹配时使用，条目重建不影响网盘任务身份。 */
import type { LibraryItemNode } from '../../shared/library/ipc'
import type { EpisodeRecord, SeriesSetting } from './state'

/** 入库推送的身份使用已核验的媒体库条目，不把任务句柄传给通知去重。 */
export function libraryLandedRecords(
  records: readonly EpisodeRecord[],
  tasks: ReadonlyMap<number, SeriesSetting>
): EpisodeRecord[] {
  return records.flatMap(record => {
    const id = tasks.get(record.seriesId)?.libraryItemId
    return id ? [{ ...record, seriesId: id }] : []
  })
}

/** 查不到表示暂不可用；确认错配则解除关联，不能使用别剧文件或目录。 */
export function createLibraryLinks(
  read: (
    itemId: number
  ) => Promise<Pick<LibraryItemNode, 'id' | 'type' | 'providerIds'> | null>,
  tasks: ReadonlyMap<number, SeriesSetting>
): {
  verify(taskId: number): Promise<number | null>
} {
  return {
    async verify(taskId) {
      const task = tasks.get(taskId)
      if (!task?.libraryItemId || !task.tmdbId) return null
      const item = await read(task.libraryItemId).catch(() => undefined)
      if (item === undefined) return null
      if (
        !item ||
        item.type !== 'series' ||
        item.providerIds.tmdb !== task.tmdbId
      ) {
        delete task.libraryItemId
        task.syncLibrary = false
        return null
      }
      return item.id
    },
  }
}
