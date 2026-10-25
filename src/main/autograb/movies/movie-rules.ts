/**
 * 电影的纯规则：分享里的一个文件是不是要找的那部电影、给它打几分；什么时候开始搜、多久搜一次、什么时候放弃。
 *
 * 认文件和剧集追更同一套思路（见 ../match-rules.ts）：视频扩展名、片库同一个解析器解出电影、
 * 片名对得上、年份相差不超过 1、没有预告 / 枪版之类的字眼、体积合理。上线追踪只要 WEB-DL / BluRay
 * 这类正式片源，所以文件名、文件夹或分享标题里要写明片源或至少 720p 的分辨率。
 * 洗版也用这里认电影文件（外加分辨率过滤）。
 */
import { parseMediaPath } from '../../../shared/library/parser'
import {
  type FileContext,
  type FileMatch,
  type ShareFileLike,
  excludedWord,
  titleMatches,
} from '../match-rules'
import { searchStart } from '../schedule-rules'
import { resolutionLabel, resolutionOf } from '../upgrade/quality-rules'

const DAY = 24 * 3_600_000
/** 电影最小体积（样片、预告） */
export const MOVIE_MIN_SIZE = 500 * 1024 * 1024
/** 电影最大体积（原盘 ISO 不要；Remux 可到 60 GB） */
export const MOVIE_MAX_SIZE = 80 * 1024 * 1024 * 1024
/** 开始搜之后多少天没找到就放弃 */
export const MOVIE_GIVE_UP_DAYS = 30
/** 没有数字 / 实体发行日期时，首映多少天后当作已上线 */
export const PREMIERE_FALLBACK_DAYS = 120

const VIDEO_EXT_RE = /\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|webm)$/i
const SOURCE_RE = /web-?dl|webrip|blu-?ray|bdrip|bd-?remux|remux|uhd\s*bd/i
const SUB_RE = /中字|中文字幕|简中|繁中|简繁|双语|中英|chs|cht/i

/** 要找的电影 */
export interface MovieTarget {
  title: string
  originalTitle: string
  year: number | null
}

/** 认电影文件的结果（通过时带分辨率） */
export type MovieMatch =
  | (Extract<FileMatch, { ok: true }> & { resolution: number | null })
  | Extract<FileMatch, { ok: false }>

/** 搜索关键词：「片名 年份」「片名」，原名不同时再加「原名 年份」 */
export function movieKeywords(target: MovieTarget): string[] {
  const year = target.year ? ` ${target.year}` : ''
  const words = [`${target.title}${year}`, target.title]
  if (target.originalTitle && !titleMatches(target.originalTitle, target.title))
    words.push(`${target.originalTitle}${year}`)
  return [...new Set(words)]
}

/** 名字对不对得上这部电影（中文名或原名） */
export function movieTitleMatches(text: string, target: MovieTarget): boolean {
  return (
    titleMatches(text, target.title) ||
    (!!target.originalTitle && titleMatches(text, target.originalTitle))
  )
}

/**
 * 认一个文件。
 * @param requireSource 为 true 时（上线追踪）必须看得出是正式片源
 */
export function matchMovieFile(
  file: ShareFileLike,
  target: MovieTarget,
  context: FileContext,
  requireSource: boolean
): MovieMatch {
  if (file.isDir) return { ok: false, reason: '是文件夹' }
  if (!VIDEO_EXT_RE.test(file.name)) return { ok: false, reason: '不是视频' }
  const excluded = excludedWord(`${context.folder} ${file.name}`)
  if (excluded) return { ok: false, reason: `含「${excluded}」` }
  if (file.size > 0 && file.size < MOVIE_MIN_SIZE)
    return { ok: false, reason: '体积太小' }
  if (file.size > MOVIE_MAX_SIZE) return { ok: false, reason: '体积太大' }

  const path = context.folder ? `${context.folder}/${file.name}` : file.name
  const parsed = parseMediaPath(path)
  if (parsed.type !== 'movie') return { ok: false, reason: '不像电影正片' }
  if (parsed.part !== undefined && parsed.part > 1)
    return { ok: false, reason: '分段文件' }

  const ownTitle = [parsed.title, parsed.altTitle ?? '', context.folder].some(
    t => movieTitleMatches(t, target)
  )
  if (!ownTitle && !movieTitleMatches(context.shareTitle, target))
    return { ok: false, reason: '片名对不上' }
  const year = parsed.year ?? yearIn(`${context.folder} ${context.shareTitle}`)
  if (target.year && year !== undefined && Math.abs(year - target.year) > 1)
    return { ok: false, reason: `是 ${year} 年的` }

  const text = `${file.name} ${context.folder} ${context.shareTitle}`
  const resolution = resolutionOf(file.name) ?? resolutionOf(context.folder)
  const source = SOURCE_RE.test(text)
  if (requireSource && !source && (resolution ?? 0) < 720)
    return { ok: false, reason: '看不出片源' }

  const reasons: string[] = []
  let score = 50
  if (ownTitle) {
    score += 15
    reasons.push('文件名含片名')
  }
  if (target.year && year === target.year) {
    score += 8
    reasons.push(`${year} 年`)
  }
  if (resolution !== null) {
    score += resolution >= 2160 ? 10 : resolution >= 1080 ? 8 : 2
    reasons.push(resolutionLabel(resolution))
  }
  if (SUB_RE.test(text)) {
    score += 8
    reasons.push('中文字幕')
  }
  if (source) {
    score += 5
    reasons.push('正式片源')
  }
  if (file.size >= 1024 ** 3 && file.size <= 40 * 1024 ** 3) {
    score += 4
    reasons.push('体积正常')
  }
  return { ok: true, score: Math.min(100, score), reasons, resolution }
}

/** 一段文字里的年份（1900–2099） */
export function yearIn(text: string): number | undefined {
  const m = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/.exec(text)
  return m ? Number(m[1]) : undefined
}

/** 分享里值得点进去的子文件夹：名字对得上片名 */
export function movieFolderWorthOpening(
  name: string,
  target: MovieTarget
): boolean {
  return !excludedWord(name) && movieTitleMatches(name, target)
}

/** TMDB release_dates 里的一条（type：3 院线、4 数字、5 实体） */
export interface ReleaseDate {
  type: number
  /** YYYY-MM-DD */
  date: string
}

/** 开始搜的日期与来历 */
export interface ReleaseStart {
  date: string | null
  source: 'digital' | 'physical' | 'premiere' | null
}

/**
 * 什么时候开始搜：各国最早的数字发行日（type 4）；没有就用最早的实体发行日（type 5）；
 * 都没有而首映已过 {@link PREMIERE_FALLBACK_DAYS} 天，就从今天开始（老片 TMDB 常缺发行信息）。
 * @param today 本地今天 YYYY-MM-DD
 */
export function releaseStart(
  dates: readonly ReleaseDate[],
  premiere: string | null,
  today: string,
  addDays: (date: string, days: number) => string
): ReleaseStart {
  const earliest = (type: number): string | null =>
    dates
      .filter(d => d.type === type)
      .map(d => d.date)
      .sort()[0] ?? null
  const digital = earliest(4)
  if (digital) return { date: digital, source: 'digital' }
  const physical = earliest(5)
  if (physical) return { date: physical, source: 'physical' }
  if (premiere && addDays(premiere, PREMIERE_FALLBACK_DAYS) <= today)
    return { date: today, source: 'premiere' }
  return { date: null, source: null }
}

/**
 * 搜过一次（没找到）之后的下一次：每天一次；开始搜后满 {@link MOVIE_GIVE_UP_DAYS} 天放弃（null）。
 * @param from 这一轮从哪天开始搜（发行日，或用户点重搜的那天）
 */
export function movieNextTry(from: string, now: number): number | null {
  const giveUp = searchStart(from) + MOVIE_GIVE_UP_DAYS * DAY
  const next = now + DAY
  return next > giveUp ? null : next
}
