/**
 * 追更的纯规则 · 整季包：分享是不是整季 / 多集合集，合集里哪些文件夹值得点进去。
 *
 * 整季包里缺的那一集常在第二页之后或更深的「剧名 / 第 1 季 / 01-10」文件夹里，
 * 所以认出合集后 finder 会多翻几页、多下几层（仍受每个分享的快照次数上限和 115 闸门约束），
 * 再用同一个认文件规则挑出那一集的单个文件。合并成一个文件的多集仍由 match-rules 拒绝。
 */
import {
  type EpisodeTarget,
  excludedWord,
  seasonIn,
  seriesTitleMatches,
} from './match-rules'

const PACK_RE =
  /全\s*\d+\s*[集话話]|合集|全集|整季|打包|complete|season\s*\d+(?!\s*e\d)|(?:^|[^a-z0-9])s\d{1,2}(?![e\d])|\d+\s*[-~～—]\s*\d+\s*[集话話]|更新至/i

const RANGE_RE =
  /(?:^|[^a-z0-9])(?:ep?|第)?\s*(\d{1,3})\s*[-~～—至到]\s*(?:ep?|第)?\s*(\d{1,3})(?:\s*[集话話])?(?![0-9p])/i

/** 名字像整季 / 多集合集（「全 30 集」「合集」「Season 1」「S01」「01-10 集」「更新至」） */
export function looksLikePack(text: string): boolean {
  return PACK_RE.test(text)
}

/** 名字里的集数区间（「01-10」「EP11-20」「第21-30集」）；没有时为 null */
export function episodeRange(name: string): [number, number] | null {
  const m = RANGE_RE.exec(name)
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2])
  return lo >= 0 && hi > lo && hi - lo <= 200 ? [lo, hi] : null
}

/** 对一个子文件夹的判断：一定点进去 / 可以点 / 不点 */
export type FolderVerdict = 'open' | 'maybe' | 'skip'

/**
 * 合集里的子文件夹：带排除字眼的不点；写了季号按季号；写了集数区间按是否包含这一集；
 * 名字对得上剧名 / 原名的点；其它（「4K」「国语」之类）算可以点。
 */
export function folderVerdict(
  name: string,
  target: EpisodeTarget
): FolderVerdict {
  if (excludedWord(name)) return 'skip'
  const season = seasonIn(name)
  if (season !== undefined && season !== target.season) return 'skip'
  const range = episodeRange(name)
  if (range) {
    const [lo, hi] = range
    return target.episode >= lo && target.episode <= hi ? 'open' : 'skip'
  }
  if (season !== undefined) return 'open'
  return seriesTitleMatches(name, target) ? 'open' : 'maybe'
}
