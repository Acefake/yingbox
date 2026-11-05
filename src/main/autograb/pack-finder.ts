/**
 * 追更 · 找合集（ADR-0050）：一部剧缺多集时，不一集一集搜，先找合集分享，点开后把里面的视频
 * 对每个缺集认一遍，认到的集直接带候选。认文件、版本打分、偏好、拉黑都沿用逐集搜的规则（match-rules.ts）。
 *
 * - 分享：剧名 / 原名对得上、标题像合集（pack-rules.ts）、不含排除词、季号对得上缺的季，新的在前，最多
 *   {@link MAX_PACK_SHARES} 个；已经覆盖全部缺集就不看后面的分享；
 * - 点开：广度优先，每个分享最多 {@link PACK_SNAPS} 次快照、{@link PACK_DEPTH} 层、每个文件夹 {@link PACK_PAGES} 页，
 *   全部经 115 闸门（由 snap 依赖保证）；带排除字眼、季号不在缺的季里的子文件夹不点；
 * - 认文件：每个视频对每个缺集走一遍 matchFile，认不出集号 / 多集合并 / 剧名对不上的跳过。
 */
import type { AutograbCandidate } from '../../shared/contract/autograb'
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
} from '../../shared/contract/grab-prefs'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import { rankCandidates } from '../../shared/release/score'
import {
  AUTO_SCORE,
  type EpisodeTarget,
  excludedWord,
  matchFile,
  seasonIn,
  seriesTitleMatches,
} from './match-rules'
import { episodeRange, looksLikePack } from './pack-rules'
import { candidateKey } from './state'

/** 最多看几个合集分享 */
export const MAX_PACK_SHARES = 3
/** 每个分享最多几次快照 */
export const PACK_SNAPS = 10
const PACK_DEPTH = 3
const PACK_PAGES = 5
/** 每集留几个候选 */
const PACK_CANDIDATES = 3
/** 115 快照每页条数（与 client.ts 一致） */
const SNAP_PAGE = 100

type Series = Pick<EpisodeTarget, 'seriesTitle' | 'originalTitle'>

/** 一个缺集 */
export interface PackTarget {
  season: number
  episode: number
}

/** 缺集的键 */
export const packKey = (t: PackTarget): string => `${t.season}:${t.episode}`

/** 依赖 */
export interface PackDeps {
  /** 关键词搜索（已带缓存） */
  search(keyword: string): Promise<NetdiskItem[]>
  /** 分享里某个文件夹从 offset 起的一页（经闸门） */
  snap(item: NetdiskItem, dirCid: string, offset: number): Promise<ShareSnap>
  blocked(shareCode: string): boolean
  block(shareCode: string): void
  /** 分享本身打不开（失效 / 提取码错）：拉黑即可，不算失败 */
  isDead(error: unknown): boolean
}

/** 选项 */
export interface PackOptions {
  prefs?: GrabPrefs
  /** 这一集撤销过的候选（candidateKey） */
  banned?(target: PackTarget): readonly string[]
}

/** 标题写明了就是某一集（「S01E22」），不是合集 */
const SINGLE_EPISODE_RE = /(?:^|[^a-z0-9])s\d{1,2}\s*e\d{1,4}(?![\d\-~e])/i

/**
 * 要看的合集分享：剧名对得上、季号对得上，而且是合集——标题像合集（「全 30 集」「合集」），
 * 或写了集数区间（「1-18」，PanSou 常这样标），或没写集号（整部剧的分享）；单集分享（「S01E22」）不要。
 * 写了集数区间的要覆盖至少一个缺集，覆盖得多的在前，其余新的在前。
 * @param missing 缺的集号（用来看区间覆盖多少）；不传不按覆盖排
 */
export function packShares(
  items: readonly NetdiskItem[],
  series: Series,
  seasons: ReadonlySet<number>,
  blocked: (shareCode: string) => boolean = () => false,
  missing: readonly number[] = []
): NetdiskItem[] {
  const covers = (title: string): number => {
    const range = episodeRange(title)
    return range
      ? missing.filter(n => n >= range[0] && n <= range[1]).length
      : 0
  }
  return items
    .filter(item => {
      if (blocked(item.shareCode)) return false
      if (!seriesTitleMatches(item.title, series)) return false
      if (excludedWord(item.title)) return false
      const range = episodeRange(item.title)
      if (range && missing.length && !covers(item.title)) return false
      if (
        !range &&
        !looksLikePack(item.title) &&
        SINGLE_EPISODE_RE.test(item.title)
      )
        return false
      const season = seasonIn(item.title)
      return season === undefined || seasons.has(season)
    })
    .sort(
      (a, b) =>
        covers(b.title) - covers(a.title) ||
        (b.datetime ?? '').localeCompare(a.datetime ?? '')
    )
    .slice(0, MAX_PACK_SHARES)
}

/** 一个分享里的文件及所在文件夹名 */
interface PackFile {
  file: ShareSnap['files'][number]
  folder: string
}

/** 广度优先点开一个合集，返回里面的全部非文件夹条目 */
async function walkPack(
  deps: PackDeps,
  item: NetdiskItem,
  seasons: ReadonlySet<number>
): Promise<{ files: PackFile[]; title: string }> {
  const out: PackFile[] = []
  let snaps = 0
  const top = await deps.snap(item, '', 0)
  snaps++
  const queue: { cid: string; name: string; depth: number }[] = []
  const visit = async (
    first: ShareSnap,
    cid: string,
    name: string,
    depth: number
  ): Promise<void> => {
    const all = [...first.files]
    let offset = first.files.length
    for (
      let page = 1;
      page < PACK_PAGES &&
      offset < first.count &&
      first.files.length >= SNAP_PAGE &&
      snaps < PACK_SNAPS;
      page++
    ) {
      const next = await deps.snap(item, cid, offset)
      snaps++
      if (!next.files.length) break
      all.push(...next.files)
      offset += next.files.length
    }
    for (const file of all) {
      if (!file.isDir) out.push({ file, folder: name })
      else if (depth < PACK_DEPTH && !excludedWord(file.name)) {
        const season = seasonIn(file.name)
        if (season === undefined || seasons.has(season))
          queue.push({ cid: file.id, name: file.name, depth: depth + 1 })
      }
    }
  }
  await visit(top, '', '', 0)
  while (queue.length && snaps < PACK_SNAPS) {
    const dir = queue.shift()!
    const page = await deps.snap(item, dir.cid, 0)
    snaps++
    await visit(page, dir.cid, dir.name, dir.depth)
  }
  return { files: out, title: top.title }
}

/**
 * 找合集并认出缺集。
 * @returns packKey(缺集) → 候选（版本分高的在前，最多 3 个）；没认到的集没有键
 */
export async function findPackCandidates(
  deps: PackDeps,
  series: Series,
  targets: readonly PackTarget[],
  options: PackOptions = {}
): Promise<Map<string, AutograbCandidate[]>> {
  const found = new Map<string, AutograbCandidate[]>()
  if (!targets.length) return found
  const seasons = new Set(targets.map(t => t.season))
  const seen = new Map<string, NetdiskItem>()
  const keywords = [series.seriesTitle.trim()]
  const original = series.originalTitle?.trim()
  if (original && original !== keywords[0]) keywords.push(original)
  let shares: NetdiskItem[] = []
  for (const keyword of keywords) {
    for (const item of await deps.search(keyword))
      if (!seen.has(item.shareCode)) seen.set(item.shareCode, item)
    shares = packShares(
      [...seen.values()],
      series,
      seasons,
      deps.blocked,
      targets.map(t => t.episode)
    )
    if (shares.length >= MAX_PACK_SHARES) break
  }
  const prefs = options.prefs ?? DEFAULT_GRAB_PREFS
  for (const item of shares) {
    try {
      const { files, title } = await walkPack(deps, item, seasons)
      for (const { file, folder } of files)
        for (const target of targets) {
          const key = candidateKey(item.shareCode, file.id)
          if (options.banned?.(target).includes(key)) continue
          const shareTitle = item.title || title
          const match = matchFile(
            file,
            { ...series, season: target.season, episode: target.episode },
            { shareTitle, folder },
            prefs
          )
          if (!match.ok) continue
          const list = found.get(packKey(target)) ?? []
          list.push({
            shareUrl: item.url,
            password: item.receiveCode,
            shareTitle,
            fileId: file.id,
            fileName: file.name,
            size: file.size,
            score: match.score,
            quality: match.quality,
            specs: match.specs,
            reasons: match.reasons,
          })
          found.set(packKey(target), list)
        }
    } catch (error) {
      if (deps.isDead(error)) deps.block(item.shareCode)
      else throw error
    }
    if (targets.every(t => found.has(packKey(t)))) break
  }
  for (const [key, list] of found) {
    const unique = new Map<string, AutograbCandidate>()
    for (const c of rankCandidates(list, AUTO_SCORE))
      if (!unique.has(c.fileId)) unique.set(c.fileId, c)
    found.set(key, [...unique.values()].slice(0, PACK_CANDIDATES))
  }
  return found
}
