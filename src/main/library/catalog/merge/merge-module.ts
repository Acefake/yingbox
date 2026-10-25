/**
 * 合并展示的服务入口：合并后的条目详情，手动拆分 / 恢复合并（持久化在 media_items.merge_split），
 * 并推送 items-changed 让海报墙与详情重新取数。
 */
import type {
  LibraryEvent,
  LibraryItemNode,
} from '../../../../shared/library/ipc'
import type { LibraryDb } from '../../db/database'
import { CatalogQuery } from '../query'
import { MergedItems } from './merged-items'

/** MergeModule 的依赖。 */
export interface MergeModuleOptions {
  db: LibraryDb
  /** 读单个本地条目树；缺省新建一个。 */
  catalogQuery?: CatalogQuery
  emit: (event: LibraryEvent) => void
}

/** 合并模块。 */
export class MergeModule {
  private readonly items: MergedItems

  constructor(private readonly options: MergeModuleOptions) {
    this.items = new MergedItems(
      options.db,
      options.catalogQuery ?? new CatalogQuery(options.db)
    )
  }

  /** 合并后的条目详情（含版本）；不存在返回 null。 */
  getItem(itemId: number): LibraryItemNode | null {
    return this.items.getItem(itemId)
  }

  /** 与条目合并展示的本地条目 id（含自身，升序）。 */
  membersOf(itemId: number): number[] {
    return this.items.store.membersOf(itemId)
  }

  /** 拆出一个本地条目。 */
  split({ itemId }: { itemId: number }): void {
    const members = this.items.store.split(itemId)
    this.emitChanged(itemId, members)
  }

  /** 恢复合并。 */
  join({ itemId }: { itemId: number }): void {
    const members = this.items.store.join(itemId)
    this.emitChanged(itemId, members)
  }

  /**
   * 成员关系变了：海报墙上哪条代表整组会变，条目可能出现或消失。涉及的条目同时记成 added
   * （列表按结构变化重载可见区间）和 updated（打开着的详情重新取数）。
   */
  private emitChanged(itemId: number, members: readonly number[]): void {
    const ids = [...new Set([itemId, ...members])]
    const libraryOf = this.items.store.librariesOf(ids)
    const byLibrary = new Map<number, number[]>()
    for (const id of ids) {
      const libraryId = libraryOf.get(id)
      if (libraryId === undefined) continue
      byLibrary.set(libraryId, [...(byLibrary.get(libraryId) ?? []), id])
    }
    for (const [libraryId, changed] of byLibrary) {
      this.options.emit({
        type: 'items-changed',
        libraryId,
        added: changed,
        updated: changed,
        removed: [],
        reset: false,
      })
    }
  }
}
