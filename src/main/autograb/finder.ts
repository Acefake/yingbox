/**
 * 为一集找候选：PanSou 搜 → 挑几个分享 → 看快照（必要时点进一层文件夹）→ 认文件打分。
 *
 * - 关键词：「剧名 S02E05」「剧名 第5集」「剧名」依次搜，前面的够了就不搜后面的；同一关键词的结果缓存 1 小时，
 *   多集同天更新只搜一次；
 * - 分享：去重、去掉拉黑的、分享标题对得上剧名的优先、新的优先，最多看 {@link MAX_SHARES} 个；
 * - 快照：每个分享看顶层，顶层只有一个文件夹或有对得上的季 / 剧名文件夹时点进去一层（最多 2 个），
 *   全部经 115 闸门；
 * - 结果按分数排，留前 {@link MAX_CANDIDATES} 个（同一个文件只留一次）。
 */
import type { AutograbCandidate } from '../../shared/contract/autograb'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import {
  type EpisodeTarget,
  folderWorthOpening,
  matchFile,
  titleMatches,
} from './match-rules'

/** 一集最多看几个分享 */
export const MAX_SHARES = 4
/** 一集留几个候选 */
export const MAX_CANDIDATES = 3
const CACHE_MS = 3_600_000
const MAX_FOLDERS = 2

/** 依赖 */
export interface FinderDeps {
  /** PanSou 搜索（失败抛错） */
  search(keyword: string): Promise<NetdiskItem[]>
  /** 分享里某个文件夹的条目（经闸门，失败抛错） */
  snap(item: NetdiskItem, dirCid: string): Promise<ShareSnap>
  /** 分享码是否拉黑 */
  blocked(shareCode: string): boolean
  /** 分享打不开（失效 / 提取码错）时拉黑 */
  block(shareCode: string): void
  now(): number
}

/** 找候选的结果 */
export interface FindResult {
  candidates: AutograbCandidate[]
  /** 没找到时的简短原因 */
  note: string | null
}

/** 关键词 */
export function keywordsFor(target: EpisodeTarget): string[] {
  const pad = (v: number): string => String(v).padStart(2, '0')
  return [
    `${target.seriesTitle} S${pad(target.season)}E${pad(target.episode)}`,
    `${target.seriesTitle} 第${target.episode}集`,
    target.seriesTitle,
  ]
}

/** 分享排序：标题对得上剧名的在前，再按时间新到旧 */
export function rankShares(
  items: NetdiskItem[],
  target: EpisodeTarget
): NetdiskItem[] {
  const score = (item: NetdiskItem): number =>
    titleMatches(item.title, target.seriesTitle) ? 1 : 0
  return [...items].sort(
    (a, b) =>
      score(b) - score(a) || (b.datetime ?? '').localeCompare(a.datetime ?? '')
  )
}

/** 创建查找器（带关键词缓存） */
export function createFinder(deps: FinderDeps): {
  find(target: EpisodeTarget): Promise<FindResult>
} {
  const cache = new Map<string, { at: number; items: NetdiskItem[] }>()

  async function search(keyword: string): Promise<NetdiskItem[]> {
    const hit = cache.get(keyword)
    if (hit && deps.now() - hit.at < CACHE_MS) return hit.items
    const items = await deps.search(keyword)
    cache.set(keyword, { at: deps.now(), items })
    return items
  }

  async function shares(target: EpisodeTarget): Promise<NetdiskItem[]> {
    const seen = new Map<string, NetdiskItem>()
    for (const keyword of keywordsFor(target)) {
      for (const item of await search(keyword))
        if (!seen.has(item.shareCode) && !deps.blocked(item.shareCode))
          seen.set(item.shareCode, item)
      const good = [...seen.values()].filter(i =>
        titleMatches(i.title, target.seriesTitle)
      )
      if (good.length >= MAX_SHARES) break
    }
    return rankShares([...seen.values()], target).slice(0, MAX_SHARES)
  }

  function collect(
    item: NetdiskItem,
    snap: ShareSnap,
    folder: string,
    target: EpisodeTarget,
    out: AutograbCandidate[]
  ): void {
    for (const file of snap.files) {
      const match = matchFile(file, target, {
        shareTitle: item.title || snap.title,
        folder,
      })
      if (!match.ok) continue
      out.push({
        shareUrl: item.url,
        password: item.receiveCode,
        shareTitle: item.title || snap.title,
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
    target: EpisodeTarget,
    out: AutograbCandidate[]
  ): Promise<void> {
    const top = await deps.snap(item, '')
    collect(item, top, '', target, out)
    const dirs = top.files.filter(f => f.isDir)
    const open =
      dirs.length === 1
        ? dirs
        : dirs.filter(d => folderWorthOpening(d.name, target))
    for (const dir of open.slice(0, MAX_FOLDERS)) {
      const inner = await deps.snap(item, dir.id)
      collect(item, inner, dir.name, target, out)
    }
  }

  return {
    async find(target: EpisodeTarget): Promise<FindResult> {
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
        if (found.some(c => c.score >= 85)) break
      }
      const unique = new Map<string, AutograbCandidate>()
      for (const c of found.sort((a, b) => b.score - a.score))
        if (!unique.has(c.fileId)) unique.set(c.fileId, c)
      const candidates = [...unique.values()].slice(0, MAX_CANDIDATES)
      return {
        candidates,
        note: candidates.length
          ? null
          : `看了 ${list.length} 个分享，没有这一集`,
      }
    },
  }
}

/** 分享本身打不开（失效 / 取消 / 过期 / 提取码错）：只影响这个分享，拉黑即可 */
export function isDeadShare(error: unknown): boolean {
  const code = (error as { code?: number }).code
  return code === 4100008 || code === 4100010 || code === 4100018
}
