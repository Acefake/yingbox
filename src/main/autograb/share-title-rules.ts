/**
 * 追更的纯规则 · 分享标题：看快照之前，先凭 PanSou 给的分享标题判断这个分享和要找的那一集的关系，
 * 明确是别的集 / 别的季 / 别的剧的分享直接丢掉，不花 115 快照次数。
 *
 * - exact：标题写的就是这一集（S01E20、第20集、EP20）；
 * - covers：标题写的范围包含这一集（更新至 ≥N、全 M 集（M≥N）、01-24、完结 / 合集）；
 * - unknown：没写集号（只写了剧名、季号、画质）；
 * - other：明确是别的单集、不含这一集的区间、更新还没到这一集、别的季，或标题写的是别的剧。
 *
 * 只认带明确标记的数字（集 / 话 / E / EP / 第 / 更新至 / 全），1080p、2026、H265 之类不会当成集号。
 */
import { NUMBER_PATTERN, parseNumber } from '../../shared/library/parser/cjk'
import { parseMediaPath } from '../../shared/library/parser'
import { type EpisodeTarget, seasonIn, seriesTitleMatches } from './match-rules'
import { episodeRange } from './pack-rules'

/** 分享标题与这一集的关系 */
export type ShareHint = 'exact' | 'covers' | 'unknown' | 'other'

const N = NUMBER_PATTERN
/** 季号区间：S01-S03 / 第1-3季 / Season 1-3 */
const SEASON_RANGE_RES = [
  /(?<![a-z0-9])s(\d{1,2})\s*[-~～—至到]\s*s?(\d{1,2})(?![e\d])/i,
  new RegExp(`第\\s*(${N})\\s*[-~～—至到]\\s*(${N})\\s*季`),
  /season\s*(\d{1,2})\s*[-~～—至到]\s*(\d{1,2})/i,
]
/** 全 N 季 */
const TOTAL_SEASONS_RE = new RegExp(`[全共]\\s*(${N})\\s*季`)
/** 更新至 N：更新至20集 / 更至20 / 更新到第20集 / 已更20集 / 更新至S01E20 */
const UPDATED_RE = new RegExp(
  `(?:更新?[至到]|已更新?)\\s*(?:第\\s*)?(?:s\\d{1,2}\\s*)?(?:ep?\\s*)?(${N})`,
  'i'
)
/** 全 N 集：全30集 / 共30集 / 30集全 */
const TOTAL_RES = [
  new RegExp(`[全共]\\s*(${N})\\s*[集话話]`),
  /(?<!\d)(\d{1,4})\s*[集话話]\s*全/,
]
/** 带季号的集区间：S01E01-E24 / S01E01-S01E24 / S01E01-24 */
const SE_RANGE_RE =
  /(?<![a-z0-9])s\d{1,2}\s*e(\d{1,4})\s*[-~～—至到]\s*(?:s\d{1,2})?\s*e?(\d{1,4})(?![a-z0-9])/i
/** 单集：S01E20 / 第20集 / EP20 / Episode 20（同一标题里出现几个时按区间看） */
const SINGLE_RES = [
  /(?<![a-z0-9])s\d{1,2}\s*e(\d{1,4})(?![a-z0-9])/gi,
  new RegExp(`第\\s*(${N})\\s*[集话話]`, 'g'),
  /(?<![a-z0-9])(?:ep|episode)\s*\.?\s*(\d{1,4})(?![a-z0-9])/gi,
]
/** 整部 / 整季的字眼 */
const WHOLE_RE = /完结|完結|全集|合集|整季|打包|complete/i

/** 标题里的季号区间（含「全 N 季」）；没写为 null */
function seasonRangeOf(title: string): [number, number] | null {
  for (const re of SEASON_RANGE_RES) {
    const m = re.exec(title)
    const lo = m ? parseNumber(m[1]) : undefined
    const hi = m ? parseNumber(m[2]) : undefined
    if (lo !== undefined && hi !== undefined && hi > lo) return [lo, hi]
  }
  const total = TOTAL_SEASONS_RE.exec(title)
  const count = total ? parseNumber(total[1]) : undefined
  return count ? [1, count] : null
}

/** S01E01-E24 这类带季号的集区间；没有时为 null */
function seRangeOf(title: string): [number, number] | null {
  const m = SE_RANGE_RE.exec(title)
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2])
  return hi > lo ? [lo, hi] : null
}

/** 标题里明确写的单集号（去重） */
function singleEpisodes(title: string): number[] {
  const out = new Set<number>()
  for (const re of SINGLE_RES)
    for (const m of title.matchAll(re)) {
      const n = parseNumber(m[1])
      if (n !== undefined) out.add(n)
    }
  return [...out]
}

/**
 * 只看集号 / 季号的关系。
 *
 * TODO: 与 `src/shared/netdisk/episode-hint.ts` 的 `episodeHint`（网盘页集号搜索）合并，
 * 那边合进 main 后这里直接复用它，只保留下面的别的剧判断。
 */
export function episodeHintOf(
  title: string,
  target: Pick<EpisodeTarget, 'season' | 'episode'>
): ShareHint {
  const seasons = seasonRangeOf(title)
  if (seasons) {
    if (target.season < seasons[0] || target.season > seasons[1]) return 'other'
  } else {
    const season = seasonIn(title)
    if (season !== undefined && season !== target.season) return 'other'
  }
  const ep = target.episode
  const updated = UPDATED_RE.exec(title)
  if (updated) {
    const upTo = parseNumber(updated[1]) ?? 0
    if (upTo === ep) return 'exact'
    return upTo > ep ? 'covers' : 'other'
  }
  const total = TOTAL_RES.map(re => re.exec(title)).find(Boolean)
  if (total) return (parseNumber(total[1]) ?? 0) >= ep ? 'covers' : 'other'
  const range = seRangeOf(title) ?? episodeRange(title)
  if (range) return ep >= range[0] && ep <= range[1] ? 'covers' : 'other'
  const singles = singleEpisodes(title)
  if (singles.length > 1) {
    const lo = Math.min(...singles)
    const hi = Math.max(...singles)
    return ep >= lo && ep <= hi ? 'covers' : 'other'
  }
  if (singles.length === 1) return singles[0] === ep ? 'exact' : 'other'
  if (seasons || WHOLE_RE.test(title)) return 'covers'
  return 'unknown'
}

/**
 * 标题明确写的是别的剧：没提到剧名 / 原名，且标题按单集解析出一个像样的剧名（≥2 字），
 * 如找「繁花」时的「庆余年 S02E05」。只写了画质、「电视剧合集」之类认不出剧名的标题不算。
 */
export function otherSeries(title: string, target: EpisodeTarget): boolean {
  if (!title.trim() || seriesTitleMatches(title, target)) return false
  const parsed = parseMediaPath(title)
  if (parsed.type !== 'episode') return false
  const name = parsed.title.replace(/[\s\p{P}\p{S}]+/gu, '')
  return name.length >= 2
}

/** 分享标题与这一集的关系（别的剧也算 other） */
export function shareHint(title: string, target: EpisodeTarget): ShareHint {
  if (otherSeries(title, target)) return 'other'
  return episodeHintOf(title, target)
}
