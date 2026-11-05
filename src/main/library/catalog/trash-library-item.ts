import {
  LibraryError,
  type LibraryItemNode,
  type TrashFileTarget,
  type TrashItemRequest,
} from '../../../shared/library/ipc'
import { type LibraryDb, transaction } from '../db/database'
import type { LibraryServiceOptions } from '../engine/service-options'
import type { KeyedMutex } from '../jobs/keyed-mutex'
import type { LibraryRecord } from '../libraries/library-store'
import { pathKey } from '../scanner/rules'
import { type CatalogStore, ItemChanges } from './catalog-store'
import { itemTrashFiles } from './item-trash-files'
import { MergeStore } from './merge/merge-store'
import type { CatalogQuery } from './query'

interface TrashDeps {
  db: LibraryDb
  catalog: CatalogStore
  query: CatalogQuery
  locks: KeyedMutex<number>
  library(id: number): LibraryRecord
  isCloud(lib: LibraryRecord): Promise<boolean>
  trash: NonNullable<LibraryServiceOptions['trashFiles']>
  emit(id: number, changes: ItemChanges): void
}

function videosOf(node: LibraryItemNode): LibraryItemNode['files'] {
  return node.files
    .filter(file => file.kind === 'video')
    .concat(node.children.flatMap(videosOf))
}

/** 在参与媒体库的锁内回收文件，部分失败时只清掉已回收的记录。 */
export async function trashLibraryItem(
  { itemId, addedAt, memberIds }: TrashItemRequest,
  deps: TrashDeps
): Promise<number> {
  const merge = new MergeStore(deps.db)
  const members = [...memberIds].sort((a, b) => a - b)
  const libraries = merge.librariesOf(members)
  const libraryIds = [...new Set(libraries.values())].sort((a, b) => a - b)

  const run = async (index: number): Promise<number> => {
    const id = libraryIds[index]
    if (id !== undefined) return deps.locks.run(id, () => run(index + 1))

    const current = merge.membersOf(itemId).sort((a, b) => a - b)
    const items = current.map(id => deps.query.getItem(id))
    if (
      items.find(item => item?.id === itemId)?.addedAt !== addedAt ||
      current.join(',') !== members.join(',') ||
      items.some(
        item =>
          !item ||
          (item.type !== 'movie' && item.type !== 'series') ||
          libraries.get(item.id) !== item.libraryId
      )
    )
      throw new LibraryError('conflict', '条目或合并版本已变化，请刷新后重试')

    const writerPaths = new Set(
      deps.db
        .prepare(
          'SELECT path FROM writer_outputs WHERE item_id IN (SELECT value FROM json_each(?))'
        )
        .all(JSON.stringify(members))
        .map(row => String(row.path))
    )
    const targets: Array<{
      root: string
      libraryId: number
      file: TrashFileTarget
    }> = []
    for (const libraryId of libraryIds) {
      const lib = deps.library(libraryId)
      if (await deps.isCloud(lib))
        throw new LibraryError('conflict', '包含网盘文件，无法移到系统回收站')

      const videos = new Map<number, LibraryItemNode['files'][number]>()
      const titles: string[] = []
      for (const item of items) {
        if (!item || item.libraryId !== libraryId) continue
        titles.push(item.title)
        if (item.originalTitle) titles.push(item.originalTitle)
        for (const file of videosOf(item)) videos.set(file.id, file)
      }
      for (const id of videos.keys()) {
        if (
          deps.catalog.topLevelOfFile(id).some(owner => !libraries.has(owner))
        )
          throw new LibraryError('conflict', '该视频也属于其他媒体条目')
      }
      for (const file of await itemTrashFiles(
        lib.root,
        [...videos.values()],
        writerPaths,
        titles
      ))
        targets.push({ root: lib.root, libraryId, file })
    }
    if (!targets.length)
      throw new LibraryError('not-found', '没有可删除的本地视频文件')

    // 等待文件系统时，匹配或拆分可能改变合并组。
    if (
      merge
        .membersOf(itemId)
        .sort((a, b) => a - b)
        .join(',') !== members.join(',')
    )
      throw new LibraryError('conflict', '合并版本已变化，请刷新后重试')

    const { moved, error } = await deps.trash(targets)
    const changesByLibrary = new Map<number, ItemChanges>()
    const lookup = deps.db.prepare('SELECT id FROM files WHERE path = ?')
    const forget = deps.db.prepare('DELETE FROM files WHERE path = ?')
    const forgetOutput = deps.db.prepare(
      'DELETE FROM writer_outputs WHERE path = ?'
    )
    const removeItem = deps.db.prepare('DELETE FROM media_items WHERE id = ?')
    transaction(deps.db, () => {
      const changesFor = (id: number): ItemChanges => {
        let changes = changesByLibrary.get(id)
        if (!changes) changesByLibrary.set(id, (changes = new ItemChanges()))
        return changes
      }
      for (const { libraryId, file } of targets.slice(0, moved)) {
        const key = pathKey(file.path)
        const row = lookup.get(key)
        if (row) {
          for (const owner of deps.catalog.topLevelOfFile(Number(row.id)))
            changesFor(libraryId).touch(owner)
        }
        forget.run(key)
        forgetOutput.run(key)
      }
      if (!error) {
        for (const [id, libraryId] of libraries) {
          removeItem.run(id)
          const changes = changesFor(libraryId)
          changes.updated.delete(id)
          changes.removed.add(id)
        }
        deps.catalog.clearCache()
      }
      for (const [id, changes] of changesByLibrary) {
        deps.catalog.collectGarbage(id, changes)
        deps.catalog.bumpUpdated(changes, Date.now())
      }
    })
    for (const [id, changes] of changesByLibrary) deps.emit(id, changes)
    if (error) {
      const message = moved
        ? `已移到回收站 ${moved} 个文件，其余文件未移动：${error}`
        : error
      throw new LibraryError('conflict', message)
    }
    return moved
  }

  return run(0)
}
