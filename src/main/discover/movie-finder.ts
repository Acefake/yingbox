/**
 * 为一部电影找候选：PanSou 搜 → 挑几个分享 → 看快照（必要时点进一层文件夹）→ 按电影规则认文件打分。
 *
 * 与追更的查找器同一套依赖（{@link FinderDeps}）：快照经 115 闸门、拉黑表与追更共用。
 * - 关键词：「片名 年份」「片名」「原名 年份」依次搜，对得上片名的分享够了就不再搜；同一关键词缓存 1 小时；
 * - 分享：去重、去掉拉黑的、标题对得上片名的优先、新的优先，最多看 {@link MAX_MOVIE_SHARES} 个；
 * - 快照：顶层只有一个文件夹或有对得上片名的文件夹时点进去一层（最多 2 个）；
 * - 结果按分数排，同一个文件只留一次，留前 {@link MAX_MOVIE_CANDIDATES} 个。
 */
import type { AutograbCandidate } from '../../shared/contract/autograb'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import {
  type FindResult,
  type FinderDeps,
  isDeadShare,
} from '../autograb/finder'
import {
  type MovieTarget,
  matchMovieFile,
  movieFolderWorthOpening,
  movieTitleMatches,
} from './movie-rules'

/** 一部电影最多看几个分享 */
export const MAX_MOVIE_SHARES = 4
/** 留几个候选 */
export const MAX_MOVIE_CANDIDATES = 3
const CACHE_MS = 3_600_000
const MAX_FOLDERS = 2
/** 有候选到这个分数就不再看后面的分享（省 115 查询次数） */
const GOOD_ENOUGH = 85

/** 搜索关键词（去重、去空） */
export function movieKeywords(target: MovieTarget): string[] {
  const year = target.year ? ` ${target.year}` : ''
  const list = [`${target.title}${year}`, target.title]
  if (target.originalTitle && target.originalTitle !== target.title)
    list.push(`${target.originalTitle}${year}`)
  return [...new Set(list.map(k => k.trim()).filter(Boolean))]
}

/** 分享排序：标题对得上片名的在前，再按时间新到旧 */
export function rankMovieShares(
  items: NetdiskItem[],
  target: MovieTarget
): NetdiskItem[] {
  const score = (item: NetdiskItem): number =>
    movieTitleMatches(item.title, target) ? 1 : 0
  return [...items].sort(
    (a, b) =>
      score(b) - score(a) || (b.datetime ?? '').localeCompare(a.datetime ?? '')
  )
}

/** 创建电影查找器（带关键词缓存） */
export function createMovieFinder(deps: FinderDeps): {
  find(target: MovieTarget): Promise<FindResult>
} {
  const cache = new Map<string, { at: number; items: NetdiskItem[] }>()

  async function search(keyword: string): Promise<NetdiskItem[]> {
    const hit = cache.get(keyword)
    if (hit && deps.now() - hit.at < CACHE_MS) return hit.items
    const items = await deps.search(keyword)
    cache.set(keyword, { at: deps.now(), items })
    return items
  }

  async function shares(target: MovieTarget): Promise<NetdiskItem[]> {
    const seen = new Map<string, NetdiskItem>()
    for (const keyword of movieKeywords(target)) {
      for (const item of await search(keyword))
        if (!seen.has(item.shareCode) && !deps.blocked(item.shareCode))
          seen.set(item.shareCode, item)
      const good = [...seen.values()].filter(i =>
        movieTitleMatches(i.title, target)
      )
      if (good.length >= MAX_MOVIE_SHARES) break
    }
    return rankMovieShares([...seen.values()], target).slice(
      0,
      MAX_MOVIE_SHARES
    )
  }

  function collect(
    item: NetdiskItem,
    snap: ShareSnap,
    folder: string,
    target: MovieTarget,
    out: AutograbCandidate[]
  ): void {
    const shareTitle = item.title || snap.title
    for (const file of snap.files) {
      const match = matchMovieFile(file, target, { shareTitle, folder })
      if (!match.ok) continue
      out.push({
        shareUrl: item.url,
        password: item.receiveCode,
        shareTitle,
        fileId: file.id,
        fileName: file.name,
        size: file.size,
        score: match.score,
        reasons: match.reasons,
      })
    }
  }

  async function inspect(
    item: NetdiskItem,
    target: MovieTarget,
    out: AutograbCandidate[]
  ): Promise<void> {
    const top = await deps.snap(item, '', 0)
    collect(item, top, '', target, out)
    const dirs = top.files.filter(f => f.isDir)
    const open =
      dirs.length === 1
        ? dirs
        : dirs.filter(d => movieFolderWorthOpening(d.name, target))
    for (const dir of open.slice(0, MAX_FOLDERS)) {
      const inner = await deps.snap(item, dir.id, 0)
      collect(item, inner, dir.name, target, out)
    }
  }

  return {
    async find(target: MovieTarget): Promise<FindResult> {
      const list = await shares(target)
      if (!list.length) return { candidates: [], note: 'PanSou 没有搜到分享' }
      const found: AutograbCandidate[] = []
      for (const item of list) {
        try {
          await inspect(item, target, found)
        } catch (error) {
          if (isDeadShare(error)) deps.block(item.shareCode)
          else throw error
        }
        if (found.some(c => c.score >= GOOD_ENOUGH)) break
      }
      const unique = new Map<string, AutograbCandidate>()
      for (const c of found.sort((a, b) => b.score - a.score))
        if (!unique.has(c.fileId)) unique.set(c.fileId, c)
      const candidates = [...unique.values()].slice(0, MAX_MOVIE_CANDIDATES)
      return {
        candidates,
        note: candidates.length
          ? null
          : `看了 ${list.length} 个分享，没有对得上片名和年份的正片`,
      }
    },
  }
}
