/**
 * 洗版 · 清点片库：哪些电影 / 单集的文件分辨率低于目标。
 *
 * 只看按网盘处理（CloudDrive2 挂载 115）、用 TMDB 识别、且已匹配的电影库和剧集库——新文件要存回
 * 同一个 115 文件夹，本地盘上的库洗不了。每个条目取它最好的那个视频文件判断；第 0 季（特别篇）不洗。
 * 每周清点一次，条目详情逐个取（本地引擎调用，不碰 115）。
 */
import type {
  LibraryInfo,
  LibraryItemNode,
  LibraryQuery,
  LibraryQueryResult,
} from '../../../shared/library/ipc'
import { needsUpgrade, resolutionOf } from './quality-rules'

/** 清点出的一个低分辨率文件 */
export interface ScanHit {
  itemId: number
  kind: 'movie' | 'episode'
  title: string
  year: number | null
  season: number | null
  episode: number | null
  filePath: string
  resolution: number | null
}

/** 清点要的片库能力 */
export interface LibraryReader {
  listLibraries(): Promise<LibraryInfo[]>
  query(query: LibraryQuery): Promise<LibraryQueryResult>
  getItem(itemId: number): Promise<LibraryItemNode | null>
}

const PAGE = 500

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** 一个条目里分辨率最高的视频文件；没有视频文件为 null */
function bestVideo(
  node: LibraryItemNode
): { path: string; resolution: number | null } | null {
  let best: { path: string; resolution: number | null } | null = null
  for (const file of node.files) {
    if (file.kind !== 'video') continue
    const resolution = resolutionOf(baseName(file.path))
    if (!best || (resolution ?? 0) > (best.resolution ?? 0))
      best = { path: file.path, resolution }
  }
  return best
}

/** 一个顶层条目（电影或整部剧）里要洗的文件 */
export function lowResHits(node: LibraryItemNode, target: number): ScanHit[] {
  const hits: ScanHit[] = []
  const add = (
    item: LibraryItemNode,
    kind: ScanHit['kind'],
    season: number | null
  ): void => {
    const best = bestVideo(item)
    if (!best || !needsUpgrade(best.resolution, target)) return
    hits.push({
      itemId: item.id,
      kind,
      title: node.title,
      year: node.year,
      season,
      episode: kind === 'episode' ? item.episodeNumber : null,
      filePath: best.path,
      resolution: best.resolution,
    })
  }
  if (node.type === 'movie') add(node, 'movie', null)
  else
    for (const season of node.children)
      if ((season.seasonNumber ?? 0) > 0)
        for (const ep of season.children)
          if (ep.episodeNumber !== null) add(ep, 'episode', season.seasonNumber)
  return hits
}

/** 能洗的库：网盘、TMDB、电影或剧集 */
export function upgradableLibraries(libraries: LibraryInfo[]): LibraryInfo[] {
  return libraries.filter(l => l.cloud === true && l.source === 'tmdb')
}

/** 清点全部能洗的库 */
export async function scanLibraries(
  reader: LibraryReader,
  target: number
): Promise<ScanHit[]> {
  const hits: ScanHit[] = []
  for (const library of upgradableLibraries(await reader.listLibraries())) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await reader.query({
        libraryId: library.id,
        types: [library.kind === 'movie' ? 'movie' : 'series'],
        matchStates: ['auto', 'locked'],
        offset,
        limit: PAGE,
      })
      for (const item of page.items) {
        const node = await reader.getItem(item.id)
        if (node) hits.push(...lowResHits(node, target))
      }
      if (offset + page.items.length >= page.total || !page.items.length) break
    }
  }
  return hits
}
