/**
 * 为一集找候选：PanSou 搜 → 挑几个分享 → 看快照（必要时点进一层文件夹）→ 认文件打分。
 *
 * - 关键词：「剧名 S02E05」「剧名 第5集」「剧名」依次搜，前面的够了就不搜后面的；同一关键词的结果缓存 1 小时，
 *   多集同天更新只搜一次；
 * - 分享：去重、去掉拉黑的、分享标题对得上剧名的优先、新的优先，最多看 {@link MAX_SHARES} 个；
 * - 快照：每个分享看顶层，顶层只有一个文件夹或有对得上的季 / 剧名文件夹时点进去一层（最多 2 个），
 *   全部经 115 闸门；
 * - 整季包（见 pack-rules.ts）：分享标题 / 文件夹像合集，或一页装不下时，按文件夹判断多下几层、多翻几页，
 *   每个分享最多 {@link PACK_MAX_SNAPS} 次快照；挑到这一集就不再往下翻；
 * - 偏好与撤销过的候选：认文件用这部剧的偏好，撤销过的候选不再列出；
 * - 结果按分数排，留前 {@link MAX_CANDIDATES} 个（同一个文件只留一次）。
 */
import type { AutograbCandidate } from '../../shared/contract/autograb'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import {
  DEFAULT_MATCH_PREFS,
  type EpisodeTarget,
  type MatchPrefs,
  folderWorthOpening,
  matchFile,
  titleMatches,
} from './match-rules'
import { folderVerdict, looksLikePack } from './pack-rules'
import { candidateKey } from './state'

/** 一集最多看几个分享 */
export const MAX_SHARES = 4
/** 一集留几个候选 */
export const MAX_CANDIDATES = 3
const CACHE_MS = 3_600_000
const MAX_FOLDERS = 2
/** 找一集最多用几次快照（所有分享合计；整季包展开更费，到了就不再看下一个分享） */
export const FIND_MAX_SNAPS = 20
/** 整季包：每个分享最多几次快照、下几层、每个文件夹翻几页 */
export const PACK_MAX_SNAPS = 10
const PACK_MAX_DEPTH = 3
const PACK_MAX_PAGES = 5
/** 115 快照每页条数（与 client.ts 一致） */
const SNAP_PAGE = 100

/** 依赖 */
export interface FinderDeps {
  /** PanSou 搜索（失败抛错） */
  search(keyword: string): Promise<NetdiskItem[]>
  /** 分享里某个文件夹从 offset 起的一页条目（经闸门，失败抛错） */
  snap(item: NetdiskItem, dirCid: string, offset: number): Promise<ShareSnap>
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

/** 找候选的选项 */
export interface FindOptions {
  prefs?: MatchPrefs
  /** 撤销过的候选（candidateKey） */
  banned?: readonly string[]
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
  find(target: EpisodeTarget, options?: FindOptions): Promise<FindResult>
} {
  const cache = new Map<string, { at: number; items: NetdiskItem[] }>()
  /** 这一次 find 用了几次快照（service 里 find 不并发） */
  let used = 0
  const snap = (
    item: NetdiskItem,
    dirCid: string,
    offset: number
  ): Promise<ShareSnap> => {
    used++
    return deps.snap(item, dirCid, offset)
  }

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

  /** 一页快照里认出这一集的文件；返回认出了几个 */
  function collect(
    item: NetdiskItem,
    snap: ShareSnap,
    folder: string,
    target: EpisodeTarget,
    options: FindOptions,
    out: AutograbCandidate[]
  ): number {
    let hits = 0
    for (const file of snap.files) {
      if (options.banned?.includes(candidateKey(item.shareCode, file.id)))
        continue
      const shareTitle = item.title || snap.title
      const match = matchFile(
        file,
        target,
        { shareTitle, folder },
        options.prefs ?? DEFAULT_MATCH_PREFS
      )
      if (!match.ok) continue
      hits++
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
    return hits
  }

  /** 普通分享：顶层 + 最多 2 个值得看的子文件夹，各看第一页 */
  async function inspect(
    item: NetdiskItem,
    top: ShareSnap,
    target: EpisodeTarget,
    options: FindOptions,
    out: AutograbCandidate[]
  ): Promise<void> {
    collect(item, top, '', target, options, out)
    const dirs = top.files.filter(f => f.isDir)
    const open =
      dirs.length === 1
        ? dirs
        : dirs.filter(d => folderWorthOpening(d.name, target))
    for (const dir of open.slice(0, MAX_FOLDERS)) {
      const inner = await snap(item, dir.id, 0)
      collect(item, inner, dir.name, target, options, out)
    }
  }

  /**
   * 整季包：广度优先往下走，每个文件夹翻页直到取完或到页数上限；子文件夹按 folderVerdict 挑
   * （一定点的先点；可以点的只在这一层不超过 3 个文件夹时点）。快照次数到上限或挑到这一集就停。
   */
  async function inspectPack(
    item: NetdiskItem,
    top: ShareSnap,
    target: EpisodeTarget,
    options: FindOptions,
    out: AutograbCandidate[]
  ): Promise<void> {
    let snaps = 1
    const queue: { cid: string; name: string; depth: number }[] = []
    const visit = async (
      first: ShareSnap,
      cid: string,
      name: string,
      depth: number
    ): Promise<boolean> => {
      const files = [...first.files]
      let hits = collect(item, first, name, target, options, out)
      let offset = first.files.length
      for (
        let page = 1;
        page < PACK_MAX_PAGES &&
        offset < first.count &&
        first.files.length >= SNAP_PAGE &&
        snaps < PACK_MAX_SNAPS &&
        !hits;
        page++
      ) {
        const next = await snap(item, cid, offset)
        snaps++
        if (!next.files.length) break
        files.push(...next.files)
        hits += collect(item, next, name, target, options, out)
        offset += next.files.length
      }
      if (hits) return true
      if (depth >= PACK_MAX_DEPTH) return false
      const dirs = files.filter(f => f.isDir)
      const verdicts = dirs.map(
        d => [d, folderVerdict(d.name, target)] as const
      )
      const few = dirs.length <= 3
      for (const [dir, verdict] of verdicts)
        if (verdict === 'open' || (verdict === 'maybe' && few))
          queue.push({ cid: dir.id, name: dir.name, depth: depth + 1 })
      return false
    }
    if (await visit(top, '', '', 0)) return
    while (queue.length && snaps < PACK_MAX_SNAPS) {
      const dir = queue.shift()!
      const page = await snap(item, dir.cid, 0)
      snaps++
      if (await visit(page, dir.cid, dir.name, dir.depth)) return
    }
  }

  /** 看一个分享：先看顶层，像合集就按整季包走，否则按普通分享 */
  async function inspectShare(
    item: NetdiskItem,
    target: EpisodeTarget,
    options: FindOptions,
    out: AutograbCandidate[]
  ): Promise<void> {
    const top = await snap(item, '', 0)
    const pack =
      looksLikePack(item.title || top.title) ||
      top.count > top.files.length ||
      top.files.some(f => f.isDir && looksLikePack(f.name))
    if (pack) await inspectPack(item, top, target, options, out)
    else await inspect(item, top, target, options, out)
  }

  return {
    async find(
      target: EpisodeTarget,
      options: FindOptions = {}
    ): Promise<FindResult> {
      const list = await shares(target)
      if (!list.length) return { candidates: [], note: 'PanSou 没有搜到分享' }
      const found: AutograbCandidate[] = []
      used = 0
      for (const item of list) {
        if (used >= FIND_MAX_SNAPS) break
        try {
          await inspectShare(item, target, options, found)
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
