/**
 * 把同一作品的几个本地条目树合成一棵（纯函数，不碰数据库）。
 *
 * - 元数据、id 用打开的那个条目（primary）的；其余条目只贡献文件与 primary 缺的季 / 集；
 * - 电影：文件并到一起，之后按版本分组；
 * - 剧集：季按季号对齐（绝对集数挂在剧下，季号为 null），集按（季号, 集号）对齐；
 *   同一集在几处都有时文件并到同一个集节点上，成为这一集的多个版本；
 *   某处独有的季 / 集直接接进来，于是各有部分集的文件夹合成完整的季。
 *   没有集号的集（按日期编号、无编号文件）按播出日期对齐，再没有就各自保留。
 */
import type { LibraryItemNode } from '../../../../shared/library/ipc'

/** 集在季里的对齐键；对不齐（各自保留）返回 null。 */
function episodeKey(ep: LibraryItemNode): string | null {
  if (ep.episodeNumber !== null) return `e:${ep.episodeNumber}`
  if (ep.airDate) return `d:${ep.airDate}`
  return null
}

const seasonKey = (node: LibraryItemNode): string => `s:${node.seasonNumber}`

/** 节点的浅拷贝：文件与子节点换成新数组，合并时不改调用方传进来的树。 */
const copy = (node: LibraryItemNode): LibraryItemNode => ({
  ...node,
  files: [...node.files],
  children: node.children.map(copy),
})

/** 有标题 / 简介的节点优先当展示节点（没识别的那一份往往是空壳）。 */
const richer = (a: LibraryItemNode, b: LibraryItemNode): boolean =>
  !a.metadata && Boolean(b.metadata)

/** 把 from 的集并进 into（同一季或剧下的集列表）。 */
function mergeEpisodes(into: LibraryItemNode, from: LibraryItemNode): void {
  const byKey = new Map<string, LibraryItemNode>()
  for (const child of into.children) {
    if (child.type !== 'episode') continue
    const key = episodeKey(child)
    if (key) byKey.set(key, child)
  }
  for (const ep of from.children) {
    if (ep.type !== 'episode') continue
    const key = episodeKey(ep)
    const found = key ? byKey.get(key) : undefined
    if (!found) {
      const added = copy(ep)
      into.children.push(added)
      if (key) byKey.set(key, added)
      continue
    }
    if (richer(found, ep)) {
      // 另一份有元数据：换成它的展示信息，保留已并进来的文件
      const files = [...found.files, ...ep.files]
      Object.assign(found, { ...ep, files, children: found.children })
    } else {
      found.files.push(...ep.files)
    }
  }
}

/** 季、集按编号排序（与 CatalogQuery.getItem 的顺序一致：没编号的在后）。 */
function sortChildren(node: LibraryItemNode): void {
  const num = (n: number | null): number => (n === null ? Infinity : n)
  node.children.sort(
    (a, b) =>
      num(a.seasonNumber) - num(b.seasonNumber) ||
      num(a.episodeNumber) - num(b.episodeNumber) ||
      a.id - b.id
  )
  for (const child of node.children) sortChildren(child)
}

/**
 * 合并几棵同一作品的树。
 * @param primary 打开的条目（结果沿用它的 id 与元数据）
 * @param others 同键的其它本地条目树
 */
export function mergeTrees(
  primary: LibraryItemNode,
  others: readonly LibraryItemNode[]
): LibraryItemNode {
  const root = copy(primary)
  for (const other of others) {
    root.files.push(...other.files)
    if (root.type !== 'series') continue
    // 剧下直接挂的集（绝对集数）
    mergeEpisodes(root, other)
    const seasons = new Map<string, LibraryItemNode>()
    for (const child of root.children) {
      if (child.type === 'season') seasons.set(seasonKey(child), child)
    }
    for (const season of other.children) {
      if (season.type !== 'season') continue
      const found = seasons.get(seasonKey(season))
      if (!found) {
        const added = copy(season)
        root.children.push(added)
        seasons.set(seasonKey(added), added)
        continue
      }
      found.files.push(...season.files)
      mergeEpisodes(found, season)
    }
  }
  sortChildren(root)
  return root
}
