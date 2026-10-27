/**
 * 电影的纯规则：分享里的一个文件是不是要找的那部电影、给它打几分；什么时候开始搜、多久搜一次、什么时候放弃。
 *
 * 认文件和剧集追更同一套思路（见 ../match-rules.ts）：视频扩展名、片库同一个解析器解出电影、
 * 片名对得上、年份相差不超过 1、没有预告 / 枪版之类的字眼、过得了资源偏好的硬过滤（体积默认 500 MB–80 GB）。
 * 上线追踪只要 WEB-DL / BluRay 这类正式片源，所以文件名、文件夹或分享标题里要写明片源或至少 720p 的分辨率。
 * 洗版也用这里认电影文件（外加分辨率过滤）。
 *
 * 和剧集一样给两个分：匹配分 `score`（片名在文件名里、年份一致、正式片源、体积正常）决定能否全自动，
 * 版本分 `quality`（shared/release/score.ts）用来挑版本。
 */
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
} from '../../../shared/contract/grab-prefs'
import { parseMediaPath } from '../../../shared/library/parser'
import { fileQuality, qualitySpecs } from '../../../shared/release/quality'
import {
  SIZE_DEFAULTS,
  rejectByPrefs,
  versionScore,
} from '../../../shared/release/score'
import {
  type EpisodeMatch,
  type FileContext,
  type ShareFileLike,
  excludedWord,
  titleMatches,
} from '../match-rules'
import { searchStart } from '../schedule-rules'

const DAY = 24 * 3_600_000
/** 开始搜之后多少天没找到就放弃 */
export const MOVIE_GIVE_UP_DAYS = 30
/** 没有数字 / 实体发行日期时，首映多少天后当作已上线 */
export const PREMIERE_FALLBACK_DAYS = 120

const VIDEO_EXT_RE = /\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|webm)$/i

/** 要找的电影 */
export interface MovieTarget {
  title: string
  originalTitle: string
  year: number | null
}

/** 认电影文件的结果（通过时带分辨率高度） */
export type MovieMatch =
  | (Extract<EpisodeMatch, { ok: true }> & { resolution: number | null })
  | Extract<EpisodeMatch, { ok: false }>

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
 * @param prefs 电影的资源偏好
 */
export function matchMovieFile(
  file: ShareFileLike,
  target: MovieTarget,
  context: FileContext,
  requireSource: boolean,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS
): MovieMatch {
  if (file.isDir) return { ok: false, reason: '是文件夹' }
  if (!VIDEO_EXT_RE.test(file.name)) return { ok: false, reason: '不是视频' }
  const own = `${context.folder} ${file.name}`
  const excluded = excludedWord(own)
  if (excluded) return { ok: false, reason: `含「${excluded}」` }
  const quality = fileQuality(file.name, context.folder, context.shareTitle)
  const rejected = rejectByPrefs(quality, file.size, own, prefs, 'movie')
  if (rejected) return { ok: false, reason: rejected }

  const path = context.folder ? `${context.folder}/${file.name}` : file.name
  const parsed = parseMediaPath(path)
  if (parsed.type !== 'movie') return { ok: false, reason: '不像电影正片' }
  if (parsed.part !== undefined && parsed.part > 1)
    return { ok: false, reason: '分段文件' }

  const ownTitle = [parsed.title, parsed.altTitle ?? '', context.folder].some(
    t => movieTitleMatches(t, target)
  )
  const shareTitle = movieTitleMatches(context.shareTitle, target)
  if (!ownTitle && !shareTitle) return { ok: false, reason: '片名对不上' }
  const year = parsed.year ?? yearIn(`${context.folder} ${context.shareTitle}`)
  if (target.year && year !== undefined && Math.abs(year - target.year) > 1)
    return { ok: false, reason: `是 ${year} 年的` }

  const resolution = quality.height
  const source = quality.source !== null && quality.source !== 'HDTV'
  if (requireSource && !source && (resolution ?? 0) < 720)
    return { ok: false, reason: '看不出片源' }

  const reasons: string[] = []
  let score = 55
  if (ownTitle) {
    score += 20
    reasons.push('文件名含片名')
  }
  if (shareTitle) score += 5
  if (target.year && year === target.year) {
    score += 10
    reasons.push(`${year} 年`)
  }
  if (source) {
    score += 5
    reasons.push('正式片源')
  }
  const normal = SIZE_DEFAULTS.movie
  if (file.size >= normal.normalMin && file.size <= normal.normalMax) score += 5
  const text = `${file.name} ${context.folder} ${context.shareTitle}`
  const version = versionScore(quality, file.size, text, prefs, 'movie')
  return {
    ok: true,
    score: Math.min(100, score),
    quality: version.score,
    specs: qualitySpecs(quality),
    height: resolution,
    resolution,
    reasons: [...reasons, ...version.reasons],
  }
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
