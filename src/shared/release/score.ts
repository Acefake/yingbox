/**
 * 版本分（纯函数）：同一集 / 同一部片的几个文件里挑哪个。和「匹配分」（是不是这一集 / 这部片，
 * 决定能不能自动转存）分开算：
 *
 * - {@link rejectByPrefs}：资源偏好的硬过滤（最低分辨率、避开杜比视界 / HDR、必须中字、体积范围、排除词）；
 * - {@link versionScore}：0–100 的版本分，按取向加权——画质优先看分辨率 > 片源 > 杜比视界 / HDR > 体积越大越好；
 *   均衡接近原来的打分（首选分辨率加分、中字、片源、体积正常）；省空间先满足最低分辨率，HEVC 加分、
 *   REMUX 扣分、体积越小越好；
 * - {@link rankCandidates}：候选先按匹配分过线，再按版本分，最后按匹配分；
 * - {@link isBetterVersion}：洗版时候选算不算比现在的好（同分辨率时杜比视界 / REMUX 按偏好决定）。
 */
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
  resolutionHeight,
} from '../contract/grab-prefs'
import { type ReleaseQuality, resolutionLabel } from './quality'

/** 媒体种类：剧集单集 / 电影 */
export type GrabKind = 'tv' | 'movie'

const MB = 1024 * 1024
const GB = 1024 * MB

/** 各种类默认的体积范围与「体积正常」区间（字节） */
export const SIZE_DEFAULTS: Record<
  GrabKind,
  { min: number; max: number; normalMin: number; normalMax: number }
> = {
  tv: { min: 80 * MB, max: 25 * GB, normalMin: 300 * MB, normalMax: 8 * GB },
  movie: { min: 500 * MB, max: 80 * GB, normalMin: 1 * GB, normalMax: 40 * GB },
}

/** 偏好里的体积范围（字节）：没设的一端用种类默认 */
export function sizeRangeOf(
  prefs: GrabPrefs,
  kind: GrabKind
): { min: number; max: number } {
  const d = SIZE_DEFAULTS[kind]
  return {
    min: prefs.minMb !== null ? prefs.minMb * MB : d.min,
    max: prefs.maxMb !== null ? prefs.maxMb * MB : d.max,
  }
}

/** 用户的词（不分大小写、按子串）在文字里命中哪些 */
export function wordHits(words: readonly string[], text: string): string[] {
  const lower = text.toLowerCase()
  return words.filter(w => lower.includes(w.toLowerCase()))
}

/**
 * 资源偏好的硬过滤。
 * @param q 文件的画质（文件名 → 文件夹 → 分享标题合起来认）
 * @param size 字节数；0 = 不知道（不按体积拦）
 * @param text 排除词要看的文字（文件夹 + 文件名）
 * @returns 拒绝理由；通过为 null
 */
export function rejectByPrefs(
  q: ReleaseQuality,
  size: number,
  text: string,
  prefs: GrabPrefs,
  kind: GrabKind
): string | null {
  const excluded = wordHits(prefs.excludeWords, text)[0]
  if (excluded) return `含排除词「${excluded}」`
  const range = sizeRangeOf(prefs, kind)
  if (size > 0 && size < range.min) return '体积太小'
  if (size > range.max) return '体积太大'
  const min = resolutionHeight(prefs.minResolution)
  if (min !== null && q.height !== null && q.height < min)
    return `低于 ${resolutionLabel(min)}`
  if (prefs.dolbyVision === 'avoid' && q.dolbyVision)
    return '杜比视界（已避开）'
  if (prefs.hdr === 'avoid' && q.hdr) return 'HDR（已避开）'
  if (prefs.chineseSubs === 'require' && !q.chineseSubs) return '没写中文字幕'
  return null
}

/** 不限首选时各取向的分辨率分 */
const RES_POINTS: Record<GrabPrefs['strategy'], Record<number, number>> = {
  quality: { 2160: 32, 1080: 22, 720: 8, 480: 0 },
  balanced: { 2160: 24, 1080: 20, 720: 6, 480: 0 },
  compact: { 2160: 10, 1080: 20, 720: 14, 480: 4 },
}
const UNKNOWN_RES_POINTS = 10

/** 各取向的片源分 */
const SOURCE_POINTS: Record<
  GrabPrefs['strategy'],
  Record<NonNullable<ReleaseQuality['source']>, number>
> = {
  quality: { REMUX: 16, BD: 12, WEB: 8, HDTV: 2 },
  balanced: { REMUX: 6, BD: 6, WEB: 6, HDTV: 2 },
  compact: { REMUX: -12, BD: 2, WEB: 8, HDTV: 2 },
}

const PREFER_WORD_SCORE = 6
const PREFER_WORD_MAX = 18

/** 分辨率分：有首选时命中最高、高于首选次之（画质优先时几乎不扣）、低于首选按档扣 */
function resolutionPoints(
  height: number | null,
  prefs: GrabPrefs
): [number, string | null] {
  if (height === null) return [UNKNOWN_RES_POINTS, null]
  const label = resolutionLabel(height)
  const ladder = RES_POINTS[prefs.strategy]
  const preferred = resolutionHeight(prefs.resolution)
  if (preferred === null) return [ladder[height] ?? 0, label]
  if (height === preferred) return [34, `首选 ${label}`]
  if (height > preferred) return [prefs.strategy === 'quality' ? 28 : 16, label]
  return [Math.max(0, (ladder[height] ?? 0) - 8), label]
}

/** 体积分：画质优先越大越好、省空间越小越好（都在范围内按对数比例），均衡只看是否正常 */
function sizePoints(
  size: number,
  prefs: GrabPrefs,
  kind: GrabKind
): [number, string | null] {
  if (size <= 0) return [0, null]
  const d = SIZE_DEFAULTS[kind]
  if (prefs.strategy === 'balanced')
    return size >= d.normalMin && size <= d.normalMax
      ? [5, '体积正常']
      : [0, null]
  const range = sizeRangeOf(prefs, kind)
  const span = Math.log(range.max) - Math.log(range.min)
  const at = span > 0 ? (Math.log(size) - Math.log(range.min)) / span : 0.5
  const ratio = Math.max(0, Math.min(1, at))
  const big = prefs.strategy === 'quality'
  const pts = Math.round((big ? ratio : 1 - ratio) * 10)
  return [pts, pts >= 6 ? (big ? '体积大' : '体积小') : null]
}

/**
 * 版本分 0–100 与理由。
 * @param q 文件的画质
 * @param size 字节数；0 = 不知道
 * @param text 偏好词要看的文字（文件名 + 文件夹 + 分享标题）
 */
export function versionScore(
  q: ReleaseQuality,
  size: number,
  text: string,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS,
  kind: GrabKind = 'tv'
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 30
  const add = (pts: number, reason: string | null): void => {
    score += pts
    if (reason && pts > 0) reasons.push(reason)
  }
  const [res, resLabel] = resolutionPoints(q.height, prefs)
  score += res
  if (resLabel) reasons.push(resLabel)
  if (q.source) add(SOURCE_POINTS[prefs.strategy][q.source], q.source)
  if (q.dolbyVision)
    add(
      prefs.dolbyVision === 'prefer'
        ? 12
        : prefs.strategy === 'quality'
          ? 4
          : 0,
      '杜比视界'
    )
  if (q.hdr || (q.dolbyVision && prefs.hdr === 'prefer'))
    add(
      prefs.hdr === 'prefer' ? 8 : prefs.strategy === 'quality' ? 3 : 0,
      'HDR'
    )
  if (q.chineseSubs) add(prefs.chineseSubs === 'prefer' ? 14 : 8, '中文字幕')
  if (prefs.strategy === 'compact' && (q.codec === 'HEVC' || q.codec === 'AV1'))
    add(8, q.codec)
  add(...sizePoints(size, prefs, kind))
  const liked = wordHits(prefs.preferWords, text)
  if (liked.length) {
    score += Math.min(PREFER_WORD_MAX, liked.length * PREFER_WORD_SCORE)
    reasons.push(...liked.map(w => `偏好「${w}」`))
  }
  return { score: Math.max(0, Math.min(100, score)), reasons }
}

/** 排候选要的两个分 */
export interface Ranked {
  /** 匹配分 */
  score: number
  /** 版本分 */
  quality: number
}

/**
 * 候选排序（不改原数组）：匹配分过线的在前，同组按版本分，再按匹配分。
 * @param passScore 匹配分的线（全自动的门槛）
 */
export function rankCandidates<T extends Ranked>(
  list: readonly T[],
  passScore: number
): T[] {
  const pass = (c: T): number => (c.score >= passScore ? 1 : 0)
  return [...list].sort(
    (a, b) => pass(b) - pass(a) || b.quality - a.quality || b.score - a.score
  )
}

/**
 * 洗版：候选算不算比现在的文件好。
 * - 分辨率更高且达到目标：更好；
 * - 同分辨率（且达到目标）：偏好「杜比视界优先」时，候选有杜比视界而现在没有算更好；
 *   取向「画质优先」时，候选是 REMUX 而现在不是算更好；
 * - 其余都不算。
 * @param current 现在文件的画质（从文件名认）
 * @param target 目标分辨率高度
 */
export function isBetterVersion(
  current: ReleaseQuality,
  candidate: ReleaseQuality,
  target: number,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS
): boolean {
  const cand = candidate.height
  if (cand === null || cand < target) return false
  const now = current.height ?? 0
  if (cand > now) return true
  if (cand < now) return false
  if (
    prefs.dolbyVision === 'prefer' &&
    candidate.dolbyVision &&
    !current.dolbyVision
  )
    return true
  return (
    prefs.strategy === 'quality' &&
    candidate.source === 'REMUX' &&
    current.source !== 'REMUX'
  )
}

/**
 * 洗版：现在的文件要不要找更好的版本。分辨率认得出且低于目标；或已达目标，
 * 但偏好让同分辨率的杜比视界 / REMUX 算更好而它还不是。认不出分辨率的不洗。
 */
export function wantsUpgrade(
  current: ReleaseQuality,
  target: number,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS
): boolean {
  if (current.height === null) return false
  if (current.height < target) return true
  if (current.height > target) return false
  if (prefs.dolbyVision === 'prefer' && !current.dolbyVision) return true
  return prefs.strategy === 'quality' && current.source !== 'REMUX'
}
