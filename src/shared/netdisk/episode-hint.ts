/**
 * 分享 / 磁力标题和「要找的那一集」的关系（纯函数，渲染层网盘页与主进程追更共用）：
 * - exact：标题写的就是这一集（S01E20、第20集、EP20）；
 * - covers：标题写的范围包含这一集（更新至 20 集以后、全 30 集、01-24、第1集-第24集、完结 / 全集 / 合集），
 *   或季区间（S01-S03、第1-3季）包含这一季且没写集号；
 * - unknown：没写集号（只写了剧名、季号、画质）；
 * - other：明确是别的集、不含这一集的范围、更新还没到这一集，或别的季（含不包含这一季的季区间）。
 *
 * 只认带明确标记的数字（集 / 话 / E / EP / 第 / 更新至 / 全），1080p、2026、H265 之类不会当成集号。
 * fileIsEpisode 判断分享里的单个文件是不是这一集（预览里高亮）。
 */
import { NUMBER_PATTERN, parseNumber } from '../library/parser/cjk'
import { parseMediaPath } from '../library/parser/parse-path'
import type { EpisodeTarget } from './search-intent'

/** 标题与这一集的关系 */
export type EpisodeHint = 'exact' | 'covers' | 'unknown' | 'other'

const N = NUMBER_PATTERN
const B = '(?<![a-z0-9])'
const A = '(?![a-z0-9])'
/** 集号区间里的分隔符 */
const DASH = '\\s*[-~～—–至到]\\s*'

/** 季号：S02 / S02E05 里的 S02 / Season 2 / 第二季 */
const SEASON_RES = [
  new RegExp(`${B}s(\\d{1,2})(?=e\\d|${A})`, 'i'),
  new RegExp(`${B}season\\s*(\\d{1,2})${A}`, 'i'),
  new RegExp(`第\\s*(${N})\\s*季`),
]

/** 季区间：S01-S03 / S1~S3 / Season 1-3 / 第1-3季 / 第一季至第三季 */
const SEASON_RANGE_RES = [
  new RegExp(`${B}s(\\d{1,2})${DASH}s(\\d{1,2})${A}`, 'i'),
  new RegExp(
    `${B}seasons?\\s*(\\d{1,2})${DASH}(?:season\\s*)?(\\d{1,2})${A}`,
    'i'
  ),
  new RegExp(`第\\s*(${N})\\s*季?${DASH}第?\\s*(${N})\\s*季`),
]

/** 区间：第1-20集 / 第1集-第20集 / 第01至20集 / E01-E20 / EP01-20 / S01E01-E20 / 01-20集 / 01-20（不是日期） */
const RANGE_RES = [
  new RegExp(`第\\s*(${N})\\s*[集话話]?${DASH}第?\\s*(${N})\\s*[集话話]`),
  new RegExp(
    `${B}(?:s\\d{1,2})?ep?(\\d{1,4})${DASH}(?:s\\d{1,2})?(?:ep?)?(\\d{1,4})${A}`,
    'i'
  ),
  new RegExp(`(?<![\\d.\\-/])(\\d{1,4})${DASH}(\\d{1,4})\\s*[集话話]`),
  new RegExp(
    `(?<![\\da-z.\\-/:])(\\d{1,3})${DASH}(\\d{1,3})(?![\\d.\\-/:pk])`,
    'i'
  ),
]
/** 更新至 N：更新至20集 / 更至20 / 更新到第20集 / 已更20集 / 更新至S01E20 / 更新至EP20 */
const UPDATED_RE = new RegExp(
  `(?:更新?[至到]|已更新?)\\s*(?:s\\d{1,2}\\s*)?(?:ep?|第)?\\s*(${N})`,
  'i'
)
/** 全 N 集：全30集 / 共30集 / 30集全 */
const TOTAL_RES = [
  new RegExp(`[全共]\\s*(${N})\\s*[集话話]`),
  new RegExp(`(?<!\\d)(\\d{1,4})\\s*[集话話]\\s*全`),
]
/** 单集：S01E20 / 第20集 / EP20 / E20 / Episode 20 */
const SINGLE_RES = [
  new RegExp(`${B}s\\d{1,2}\\s*ep?(\\d{1,4})${A}`, 'i'),
  new RegExp(`第\\s*(${N})\\s*[集话話]`),
  new RegExp(`${B}(?:ep|episode)\\s*\\.?\\s*(\\d{1,4})${A}`, 'i'),
  new RegExp(`${B}e(\\d{1,4})${A}`, 'i'),
]
/** 整部 / 整季的字眼 */
const WHOLE_RE = /完结|完結|全集|合集|整季|打包|complete/i

/** 第一个命中的数字 */
function numberBy(text: string, res: readonly RegExp[]): number | undefined {
  for (const re of res) {
    const m = re.exec(text)
    if (m) return parseNumber(m[1])
  }
  return undefined
}

/** 标题里的季号；没写为 undefined */
export function seasonOfTitle(title: string): number | undefined {
  return numberBy(title, SEASON_RES)
}

/** 两个数组成的合理区间（lo < hi 且跨度不超过 max）；否则 null */
function rangeOf(m: RegExpExecArray, max: number): [number, number] | null {
  const lo = parseNumber(m[1])
  const hi = parseNumber(m[2])
  return lo !== undefined && hi !== undefined && hi > lo && hi - lo <= max
    ? [lo, hi]
    : null
}

/** 标题里的季区间及其在标题里的位置；没写为 null */
function seasonRangeMatch(
  title: string
): { range: [number, number]; text: string } | null {
  for (const re of SEASON_RANGE_RES) {
    const m = re.exec(title)
    const range = m && rangeOf(m, 50)
    if (m && range) return { range, text: m[0] }
  }
  return null
}

/** 标题里的季区间（S01-S03 → [1, 3]）；没写为 null */
export function seasonRangeOfTitle(title: string): [number, number] | null {
  return seasonRangeMatch(title)?.range ?? null
}

/** 标题里的集号区间；没写为 null */
export function episodeRangeOfTitle(title: string): [number, number] | null {
  for (const re of RANGE_RES) {
    const m = re.exec(title)
    const range = m && rangeOf(m, 300)
    if (range) return range
  }
  return null
}

/**
 * 标题和这一集的关系。
 * @param title 分享 / 磁力标题
 * @param target 要找的那一集（季号没写时不按季区分）
 */
export function episodeHint(title: string, target: EpisodeTarget): EpisodeHint {
  const seasons = seasonRangeMatch(title)
  if (seasons) {
    const [lo, hi] = seasons.range
    if (
      target.season !== undefined &&
      (target.season < lo || target.season > hi)
    )
      return 'other'
    // 季区间写的是多季打包：去掉它再看集号，没写集号就算包含
    const rest = title.replace(seasons.text, ' ')
    const hint = episodeHint(rest, { episode: target.episode })
    return hint === 'unknown' ? 'covers' : hint
  }
  const season = seasonOfTitle(title)
  if (
    target.season !== undefined &&
    season !== undefined &&
    season !== target.season
  )
    return 'other'
  const ep = target.episode
  const range = episodeRangeOfTitle(title)
  if (range) return ep >= range[0] && ep <= range[1] ? 'covers' : 'other'
  const updated = UPDATED_RE.exec(title)
  if (updated) {
    const upTo = parseNumber(updated[1]) ?? 0
    if (upTo === ep) return 'exact'
    return upTo > ep ? 'covers' : 'other'
  }
  const total = numberBy(title, TOTAL_RES)
  if (total !== undefined) return total >= ep ? 'covers' : 'other'
  const single = numberBy(title, SINGLE_RES)
  if (single !== undefined) return single === ep ? 'exact' : 'other'
  return WHOLE_RE.test(title) ? 'covers' : 'unknown'
}

/** 关系的先后：正好这一集 → 包含这一集 → 没写集号 */
const HINT_ORDER: Record<Exclude<EpisodeHint, 'other'>, number> = {
  exact: 0,
  covers: 1,
  unknown: 2,
}

/**
 * 按这一集排序：exact → covers → unknown（同档保持原顺序），明确是别的集的单独放进 others。
 * @param items 结果（已按用户选的方式排好）
 * @param target 要找的那一集；null 时原样返回
 * @param titleOf 取标题
 */
export function rankByEpisode<T>(
  items: readonly T[],
  target: EpisodeTarget | null,
  titleOf: (item: T) => string
): { main: T[]; others: T[] } {
  if (!target) return { main: [...items], others: [] }
  const main: Array<{ item: T; order: number; index: number }> = []
  const others: T[] = []
  items.forEach((item, index) => {
    const hint = episodeHint(titleOf(item), target)
    if (hint === 'other') others.push(item)
    else main.push({ item, order: HINT_ORDER[hint], index })
  })
  main.sort((a, b) => a.order - b.order || a.index - b.index)
  return { main: main.map(entry => entry.item), others }
}

/**
 * 分享里的一个文件是不是这一集：文件名解析出单集且集号相同；文件名或所在文件夹写了季号时季号也要相同。
 * @param name 文件名
 * @param target 要找的那一集
 * @param folder 所在文件夹名（分享标题之类，可选，用来补季号）
 */
export function fileIsEpisode(
  name: string,
  target: EpisodeTarget,
  folder = ''
): boolean {
  const parsed = parseMediaPath(folder ? `${folder}/${name}` : name)
  if (parsed.type !== 'episode' || parsed.episodes.length !== 1) return false
  if (parsed.episodes[0] !== target.episode) return false
  const season = parsed.season ?? seasonOfTitle(folder)
  return (
    target.season === undefined ||
    season === undefined ||
    season === target.season
  )
}
