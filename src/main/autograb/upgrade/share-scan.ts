/**
 * 洗版与电影追踪共用的「搜分享 → 看快照 → 认文件」：剧集追更 finder.ts 的同一套流程，
 * 认文件的规则由调用方给（剧集用 match-rules 的 matchFile，电影用 movie-rules 的 matchMovieFile）。
 *
 * - 关键词依次搜，结果缓存 1 小时；分享去重、去掉拉黑的、标题对得上的和新的优先，最多看 {@link MAX_SHARES} 个；
 * - 快照也缓存 1 小时：同一部剧连着洗几集时，同一个分享只看一次；
 * - 顶层只有一个文件夹或有值得点开的文件夹时进去一层（最多 2 个）；分享打不开就拉黑；
 * - 候选先按匹配分过线、再按版本分排（shared/release/score.ts rankCandidates），同一个文件只留一次，
 *   最多 {@link MAX_CANDIDATES} 个。
 */
import type { GrabCandidate } from '../../../shared/contract/autograb-upgrade'
import type { NetdiskItem, ShareSnap } from '../../../shared/contract/pan115'
import { rankCandidates } from '../../../shared/release/score'
import { MAX_CANDIDATES, MAX_SHARES, isDeadShare } from '../finder'
import {
  AUTO_SCORE,
  type FileContext,
  type ShareFileLike,
  titleMatches,
} from '../match-rules'

const CACHE_MS = 3_600_000
const MAX_FOLDERS = 2
/** 有这么高匹配分的候选就不再看后面的分享 */
const GOOD_ENOUGH = 85

/** 依赖 */
export interface ScanDeps {
  /** PanSou 搜索（失败抛错） */
  search(keyword: string): Promise<NetdiskItem[]>
  /** 分享里某个文件夹的条目（经闸门与子限额，失败抛错） */
  snap(item: NetdiskItem, dirCid: string): Promise<ShareSnap>
  blocked(shareCode: string): boolean
  block(shareCode: string): void
  now(): number
}

/** 认出的文件（分享字段由扫描补上） */
export interface FileHit {
  /** 匹配分 */
  score: number
  /** 版本分 */
  quality: number
  specs: string[]
  reasons: string[]
  resolution: number | null
}

/** 一次查找要找什么 */
export interface ScanPlan {
  keywords: string[]
  /** 用来给分享排序的名字 */
  title: string
  openFolder(name: string): boolean
  /** 认一个文件；不要时返回 null */
  match(file: ShareFileLike, context: FileContext): FileHit | null
}

/** 查找结果 */
export interface ScanResult {
  candidates: GrabCandidate[]
  /** 没找到时的简短原因 */
  note: string | null
}

/** 创建扫描器（带搜索与快照缓存） */
export function createShareScanner(deps: ScanDeps): {
  scan(plan: ScanPlan): Promise<ScanResult>
} {
  const searches = new Map<string, { at: number; items: NetdiskItem[] }>()
  const snaps = new Map<string, { at: number; snap: ShareSnap }>()

  async function search(keyword: string): Promise<NetdiskItem[]> {
    const hit = searches.get(keyword)
    if (hit && deps.now() - hit.at < CACHE_MS) return hit.items
    const items = await deps.search(keyword)
    searches.set(keyword, { at: deps.now(), items })
    return items
  }

  async function snap(item: NetdiskItem, dir: string): Promise<ShareSnap> {
    const key = `${item.shareCode}:${dir}`
    const hit = snaps.get(key)
    if (hit && deps.now() - hit.at < CACHE_MS) return hit.snap
    const result = await deps.snap(item, dir)
    snaps.set(key, { at: deps.now(), snap: result })
    return result
  }

  async function shares(plan: ScanPlan): Promise<NetdiskItem[]> {
    const seen = new Map<string, NetdiskItem>()
    const good = (i: NetdiskItem): boolean => titleMatches(i.title, plan.title)
    for (const keyword of plan.keywords) {
      for (const item of await search(keyword))
        if (!seen.has(item.shareCode) && !deps.blocked(item.shareCode))
          seen.set(item.shareCode, item)
      if ([...seen.values()].filter(good).length >= MAX_SHARES) break
    }
    return [...seen.values()]
      .sort(
        (a, b) =>
          Number(good(b)) - Number(good(a)) ||
          (b.datetime ?? '').localeCompare(a.datetime ?? '')
      )
      .slice(0, MAX_SHARES)
  }

  function collect(
    item: NetdiskItem,
    listing: ShareSnap,
    folder: string,
    plan: ScanPlan,
    out: GrabCandidate[]
  ): void {
    const shareTitle = item.title || listing.title
    for (const file of listing.files) {
      const hit = plan.match(file, { shareTitle, folder })
      if (!hit) continue
      out.push({
        shareUrl: item.url,
        password: item.receiveCode,
        shareTitle,
        fileId: file.id,
        fileName: file.name,
        size: file.size,
        score: hit.score,
        quality: hit.quality,
        specs: hit.specs,
        resolution: hit.resolution,
        reasons: hit.reasons,
      })
    }
  }

  async function inspect(
    item: NetdiskItem,
    plan: ScanPlan,
    out: GrabCandidate[]
  ): Promise<void> {
    const top = await snap(item, '')
    collect(item, top, '', plan, out)
    const dirs = top.files.filter(f => f.isDir)
    const open =
      dirs.length === 1 ? dirs : dirs.filter(d => plan.openFolder(d.name))
    for (const dir of open.slice(0, MAX_FOLDERS))
      collect(item, await snap(item, dir.id), dir.name, plan, out)
  }

  return {
    async scan(plan: ScanPlan): Promise<ScanResult> {
      const list = await shares(plan)
      if (!list.length) return { candidates: [], note: 'PanSou 没有搜到分享' }
      const found: GrabCandidate[] = []
      for (const item of list) {
        try {
          await inspect(item, plan, found)
        } catch (error) {
          if (isDeadShare(error)) deps.block(item.shareCode)
          else throw error
        }
        if (found.some(c => c.score >= GOOD_ENOUGH)) break
      }
      const unique = new Map<string, GrabCandidate>()
      for (const c of rankCandidates(found, AUTO_SCORE))
        if (!unique.has(c.fileId)) unique.set(c.fileId, c)
      const candidates = [...unique.values()].slice(0, MAX_CANDIDATES)
      return {
        candidates,
        note: candidates.length
          ? null
          : `看了 ${list.length} 个分享，没有合适的文件`,
      }
    },
  }
}
