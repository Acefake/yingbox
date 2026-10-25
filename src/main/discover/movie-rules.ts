/**
 * 库外发现的纯规则 · 认电影文件：分享里的一个文件是不是要找的那部电影、给它打几分。
 *
 * 只认单个正片视频：扩展名是视频、片名（中文或原名）对得上、年份对得上（允许差一年，豆瓣与 TMDB 的
 * 年份常差一年）、不带预告 / 花絮 / 枪版 / CAM 之类的字眼、体积在 {@link MIN_MOVIE_SIZE}–{@link MAX_MOVIE_SIZE}。
 * 打分：片名在文件名里、年份完全一致、分辨率、中字、片源、体积。排除字眼与剧名比较沿用追更的规则。
 */
import { parseMediaPath } from '../../shared/library/parser'
import {
  type FileContext,
  type FileMatch,
  type ShareFileLike,
  excludedWord,
  titleMatches,
} from '../autograb/match-rules'

/** 小于这个体积不要（预告、样片、低码率压制） */
export const MIN_MOVIE_SIZE = 500 * 1024 * 1024
/** 大于这个体积不要（原盘 ISO、合集） */
export const MAX_MOVIE_SIZE = 60 * 1024 * 1024 * 1024

const VIDEO_EXT_RE = /\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|flv|rmvb|webm)$/i
const SUB_RE = /中字|中文字幕|简中|繁中|简繁|双语|中英|字幕组|chs|cht/i
const REMUX_RE = /remux/i
const SOURCE_RE = /web-?dl|webrip|blu-?ray|bdrip/i
/** 分段文件（CD1 / Part 2）不当正片 */
const PART_RE = /(?:^|[^a-z])(?:cd|disc|part)\s*\d/i
const YEAR_RE = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/g

/** 要找的那部电影 */
export interface MovieTarget {
  /** 中文片名（豆瓣） */
  title: string
  /** 原名（TMDB）；不知道时为空串 */
  originalTitle: string
  /** 上映年份；不知道时为 null */
  year: number | null
}

/** 一段文字里出现的年份（1900–2099） */
export function yearsIn(text: string): number[] {
  return [...text.matchAll(YEAR_RE)].map(m => Number(m[1]))
}

/** 片名对不对得上：中文名或原名任一对上 */
export function movieTitleMatches(text: string, target: MovieTarget): boolean {
  return (
    titleMatches(text, target.title) ||
    (target.originalTitle !== '' && titleMatches(text, target.originalTitle))
  )
}

/** 分辨率加分 */
function resolutionScore(name: string): [number, string | null] {
  if (/2160p|4k|uhd/i.test(name)) return [10, '4K']
  if (/1080[pi]/i.test(name)) return [8, '1080p']
  if (/720p/i.test(name)) return [2, '720p']
  return [0, null]
}

/** 年份核对：exact = 完全一致，near = 差一年，miss = 对不上，none = 哪里都没写 */
function yearCheck(
  parsed: number | undefined,
  context: string,
  target: number | null
): 'exact' | 'near' | 'miss' | 'none' {
  const years = parsed !== undefined ? [parsed] : yearsIn(context)
  if (!years.length) return 'none'
  if (target === null) return 'near'
  if (years.includes(target)) return 'exact'
  return years.some(y => Math.abs(y - target) === 1) ? 'near' : 'miss'
}

/**
 * 认一个文件。拒绝时给出理由，通过时给分数（0–100）和加分理由。
 */
export function matchMovieFile(
  file: ShareFileLike,
  target: MovieTarget,
  context: FileContext
): FileMatch {
  if (file.isDir) return { ok: false, reason: '是文件夹' }
  if (!VIDEO_EXT_RE.test(file.name)) return { ok: false, reason: '不是视频' }
  const excluded = excludedWord(`${context.folder} ${file.name}`)
  if (excluded) return { ok: false, reason: `含「${excluded}」` }
  if (file.size > 0 && file.size < MIN_MOVIE_SIZE)
    return { ok: false, reason: '体积太小' }
  if (file.size > MAX_MOVIE_SIZE) return { ok: false, reason: '体积太大' }
  if (PART_RE.test(file.name)) return { ok: false, reason: '分段文件' }

  const path = context.folder ? `${context.folder}/${file.name}` : file.name
  const parsed = parseMediaPath(path)
  if (parsed.type === 'episode') return { ok: false, reason: '是剧集' }
  if (parsed.type === 'extra') return { ok: false, reason: '是花絮' }

  const ownTitle = [parsed.title, parsed.altTitle ?? ''].some(t =>
    movieTitleMatches(t, target)
  )
  const nearTitle =
    movieTitleMatches(context.folder, target) ||
    movieTitleMatches(context.shareTitle, target)
  if (!ownTitle && !nearTitle) return { ok: false, reason: '片名对不上' }

  const year = yearCheck(
    parsed.year,
    `${context.folder} ${context.shareTitle}`,
    target.year
  )
  if (year === 'miss') return { ok: false, reason: '年份对不上' }
  if (year === 'none') return { ok: false, reason: '没写年份' }

  const reasons: string[] = []
  let score = 50
  if (ownTitle) {
    score += 15
    reasons.push('文件名含片名')
  }
  if (year === 'exact') {
    score += 10
    reasons.push(`${target.year} 年`)
  } else reasons.push('年份差一年')
  const [resolution, label] = resolutionScore(file.name)
  score += resolution
  if (label) reasons.push(label)
  if (SUB_RE.test(`${file.name} ${context.folder} ${context.shareTitle}`)) {
    score += 8
    reasons.push('中文字幕')
  }
  if (REMUX_RE.test(file.name)) {
    score += 5
    reasons.push('原盘 Remux')
  } else if (SOURCE_RE.test(file.name)) {
    score += 3
    reasons.push('片源标注')
  }
  const gb = file.size / 1024 ** 3
  if (gb >= 2 && gb <= 30) {
    score += 5
    reasons.push('体积正常')
  }
  return { ok: true, score: Math.min(100, score), reasons }
}

/** 分享里值得点进去看的子文件夹：名字对得上片名，且不是花絮 / 预告文件夹 */
export function movieFolderWorthOpening(
  name: string,
  target: MovieTarget
): boolean {
  return !excludedWord(name) && movieTitleMatches(name, target)
}
