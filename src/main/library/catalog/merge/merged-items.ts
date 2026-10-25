/**
 * 展示层的条目详情：同键的本地条目合成一棵树，每个电影 / 集节点带版本列表，顶层带合并信息。
 *
 * 只给渲染进程（RPC getItem、悬停预览）用；写出、整理、识别仍读 CatalogQuery.getItem 的单个本地条目，
 * 不会把别的文件夹里的文件写进这个条目的 NFO 或整理计划。
 */
import type {
  ItemMergeInfo,
  LibraryItemNode,
} from '../../../../shared/library/ipc'
import type { LibraryDb } from '../../db/database'
import type { CatalogQuery } from '../query'
import { mergeTrees } from './merge-tree'
import { MergeStore } from './merge-store'
import { buildVersions, commonFolder, ownerFolder } from './version-rules'

/** 一棵树里全部节点（含根）。 */
function* walk(node: LibraryItemNode): Generator<LibraryItemNode> {
  yield node
  for (const child of node.children) yield* walk(child)
}

/** 一棵本地条目树里的视频文件路径。 */
const videoPaths = (tree: LibraryItemNode): string[] =>
  [...walk(tree)].flatMap(n =>
    n.files.filter(f => f.kind === 'video').map(f => f.path)
  )

/** 合并展示的条目详情。 */
export class MergedItems {
  readonly store: MergeStore

  constructor(
    db: LibraryDb,
    private readonly catalog: CatalogQuery
  ) {
    this.store = new MergeStore(db)
  }

  /** 条目详情（合并后）；不存在返回 null。 */
  getItem(itemId: number): LibraryItemNode | null {
    const primary = this.catalog.getItem(itemId)
    if (!primary) return null
    const memberIds = this.store.membersOf(itemId)
    const trees = new Map<number, LibraryItemNode>([[itemId, primary]])
    for (const id of memberIds) {
      if (id === itemId) continue
      const tree = this.catalog.getItem(id)
      if (tree) trees.set(id, tree)
    }

    // 文件 → 所属本地条目（版本按它拆分）；合并前记下，合并后就分不清了
    const owners = new Map<number, number>()
    for (const [id, tree] of trees) {
      for (const node of walk(tree)) {
        for (const file of node.files) owners.set(file.id, id)
      }
    }
    const merged =
      trees.size > 1
        ? mergeTrees(
            primary,
            [...trees.values()].filter(t => t !== primary)
          )
        : primary

    const meta = this.store.fileMeta(owners)
    for (const node of walk(merged)) {
      if (node.type !== 'movie' && node.type !== 'episode') continue
      const versions = buildVersions(node.files, meta)
      if (versions.length) node.versions = versions
    }
    const merge = this.mergeInfo(itemId, trees)
    if (merge) merged.merge = merge
    return merged
  }

  /** 合并信息：真合并了或被拆出时才有。 */
  private mergeInfo(
    itemId: number,
    trees: ReadonlyMap<number, LibraryItemNode>
  ): ItemMergeInfo | null {
    const splitFrom = trees.size > 1 ? 0 : this.store.splitPeers(itemId)
    if (trees.size < 2 && !splitFrom) return null
    const members = [...trees.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, tree]) => ({
        itemId: id,
        libraryId: tree.libraryId,
        folder: ownerFolder(commonFolder(videoPaths(tree))),
      }))
    return { members, splitFrom }
  }
}
