/**
 * 追更的纯规则 · 认文件：分享里的一个文件是不是要找的那一集、给它打两个分。
 *
 * 只认单集视频：扩展名是视频、文件名（连同所在文件夹）用片库同一个解析器解出同一集、剧名对得上、
 * 不带预告 / 花絮 / 枪版之类的字眼、过得了资源偏好的硬过滤（体积、排除词、最低分辨率、避开杜比视界 / HDR、
 * 必须中字，见 shared/release/score.ts）。季号缺省时从文件夹名 / 分享标题里找，都没写时只接受第 1 季。
 *
 * 两个分分开算：
 * - 匹配分 `score`（0–100）：有多确定是这一集（剧名在文件名里、分享标题也对得上、写明季号、体积正常），
 *   过 {@link AUTO_SCORE} 才允许全自动转存；
 * - 版本分 `quality`（0–100）：画质好不好、合不合偏好（shared/release/score.ts 的 versionScore），用来挑版本。
 */
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
} from '../../shared/contract/grab-prefs'
import { parseMediaPath } from '../../shared/library/parser'
import { NUMBER_PATTERN, parseNumber } from '../../shared/library/parser/cjk'
import { fileQuality, qualitySpecs } from '../../shared/release/quality'
import {
  SIZE_DEFAULTS,
  rejectByPrefs,
  versionScore,
} from '../../shared/release/score'

/** 全自动转存要的最低匹配分 */
export const AUTO_SCORE = 70

const VIDEO_EXT_RE = /\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|flv|rmvb|webm)$/i
/** 默认排除的字眼 */
export const EXCLUDE_WORDS = [
  '预告',
  '預告',
  '花絮',
  '抢先',
  '搶先',
  '枪版',
  '槍版',
  '先导',
  '彩蛋',
  'trailer',
  'sample',
  'teaser',
  'hdts',
  'hdcam',
]
/** 只按整词匹配的排除字眼（CAM / TC 太短，不能按子串） */
const EXCLUDE_TOKENS_RE = /(?:^|[^a-z])(?:cam|tc|ts-?rip)(?:[^a-z]|$)/i

const SEASON_RES = [
  /(?:^|[^a-z])s(\d{1,2})(?:e\d|[^a-z0-9]|$)/i,
  /season\s*(\d{1,2})/i,
  new RegExp(`第\\s*(${NUMBER_PATTERN})\\s*季`),
]

/** 要找的那一集 */
export interface EpisodeTarget {
  seriesTitle: string
  /** 原名（TMDB original_name）；与剧名相同或没有时不填，剧名对不上时也认它 */
  originalTitle?: string
  season: number
  episode: number
}

/** 分享里的一个文件 */
export interface ShareFileLike {
  name: string
  size: number
  isDir: boolean
}

/** 文件所在的上下文 */
export interface FileContext {
  /** 分享标题（PanSou 的 note） */
  shareTitle: string
  /** 文件所在的分享内文件夹名（顶层为空串） */
  folder: string
}

/** 认文件的结果（只有匹配分；库外发现等不挑版本的地方用） */
export type FileMatch =
  | { ok: true; score: number; reasons: string[] }
  | { ok: false; reason: string }

/** 追更认文件的结果：匹配分 + 版本分 */
export type EpisodeMatch =
  | {
      ok: true
      /** 匹配分 */
      score: number
      /** 版本分 */
      quality: number
      /** 短规格（4K · WEB · DV · 中字） */
      specs: string[]
      /** 分辨率高度；认不出为 null */
      height: number | null
      /** 匹配与版本的加分理由 */
      reasons: string[]
    }
  | { ok: false; reason: string }

/** 归一化剧名：小写、去掉空白和标点，便于互相包含比较 */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 两个剧名对不对得上：归一化后一方包含另一方，且短的至少 2 个字 */
export function titleMatches(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 2 && long.includes(short)
}

/** 文字对不对得上这部剧：剧名或原名任一对上即可 */
export function seriesTitleMatches(
  text: string,
  target: Pick<EpisodeTarget, 'seriesTitle' | 'originalTitle'>
): boolean {
  return (
    titleMatches(text, target.seriesTitle) ||
    (!!target.originalTitle && titleMatches(text, target.originalTitle))
  )
}

/** 从一段文字里找季号 */
export function seasonIn(text: string): number | undefined {
  for (const re of SEASON_RES) {
    const m = re.exec(text)
    if (!m) continue
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : parseNumber(m[1])
    if (n !== undefined && n > 0 && n < 100) return n
  }
  return undefined
}

/** 文字里有没有排除字眼 */
export function excludedWord(text: string): string | null {
  const lower = text.toLowerCase()
  const word = EXCLUDE_WORDS.find(w => lower.includes(w))
  if (word) return word
  const token = EXCLUDE_TOKENS_RE.exec(lower)
  return token ? token[0].replace(/[^a-z-]/g, '').toUpperCase() : null
}

/**
 * 认一个文件。拒绝时给出理由（记进候选淘汰原因里），通过时给匹配分、版本分和理由。
 */
export function matchFile(
  file: ShareFileLike,
  target: EpisodeTarget,
  context: FileContext,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS
): EpisodeMatch {
  if (file.isDir) return { ok: false, reason: '是文件夹' }
  if (!VIDEO_EXT_RE.test(file.name)) return { ok: false, reason: '不是视频' }
  const own = `${context.folder} ${file.name}`
  const excluded = excludedWord(own)
  if (excluded) return { ok: false, reason: `含「${excluded}」` }
  const quality = fileQuality(file.name, context.folder, context.shareTitle)
  const rejected = rejectByPrefs(quality, file.size, own, prefs, 'tv')
  if (rejected) return { ok: false, reason: rejected }

  const path = context.folder ? `${context.folder}/${file.name}` : file.name
  const parsed = parseMediaPath(path)
  if (parsed.type !== 'episode') return { ok: false, reason: '认不出集号' }
  if (parsed.episodes.length !== 1) return { ok: false, reason: '多集合并文件' }
  if (parsed.episodes[0] !== target.episode)
    return { ok: false, reason: `是第 ${parsed.episodes[0]} 集` }

  const season =
    parsed.season ?? seasonIn(context.folder) ?? seasonIn(context.shareTitle)
  if (season !== undefined && season !== target.season)
    return { ok: false, reason: `是第 ${season} 季` }
  if (season === undefined && target.season !== 1)
    return { ok: false, reason: '没写季号' }

  const titles = [parsed.title, parsed.altTitle ?? '', context.folder]
  const ownTitle = titles.some(t => seriesTitleMatches(t, target))
  const shareTitle = seriesTitleMatches(context.shareTitle, target)
  if (!ownTitle && !shareTitle) return { ok: false, reason: '剧名对不上' }

  const reasons: string[] = []
  let score = 55
  if (ownTitle) {
    score += 20
    reasons.push('文件名含剧名')
  }
  if (shareTitle) score += 5
  if (season !== undefined) {
    score += 10
    reasons.push(`第 ${season} 季`)
  }
  const normal = SIZE_DEFAULTS.tv
  if (file.size >= normal.normalMin && file.size <= normal.normalMax) score += 5
  const all = `${file.name} ${context.folder} ${context.shareTitle}`
  const version = versionScore(quality, file.size, all, prefs, 'tv')
  return {
    ok: true,
    score: Math.min(100, score),
    quality: version.score,
    specs: qualitySpecs(quality),
    height: quality.height,
    reasons: [...reasons, ...version.reasons],
  }
}

/** 分享里值得点进去看的子文件夹：名字对得上剧名 / 原名、季号相符或是「第 N 季」这类季文件夹 */
export function folderWorthOpening(
  name: string,
  target: EpisodeTarget
): boolean {
  if (excludedWord(name)) return false
  const season = seasonIn(name)
  if (season !== undefined) return season === target.season
  return seriesTitleMatches(name, target)
}
