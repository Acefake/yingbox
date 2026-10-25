/**
 * 追更的纯规则 · 认文件：分享里的一个文件是不是要找的那一集、给它打几分。
 *
 * 只认单集视频：扩展名是视频、文件名（连同所在文件夹）用片库同一个解析器解出同一集、剧名对得上、
 * 不带预告 / 花絮 / 枪版之类的字眼、体积不离谱。季号缺省时从文件夹名 / 分享标题里找，
 * 都没写时只接受第 1 季。分数 0–100，过 {@link AUTO_SCORE} 才允许全自动转存。
 *
 * 用户偏好（{@link MatchPrefs}）接进同一套规则：排除词命中即拒、体积上下限替换默认范围、
 * 首选分辨率与偏好词改分数。
 */
import type {
  AutograbPrefs,
  AutograbResolution,
} from '../../shared/contract/autograb-prefs'
import { parseMediaPath } from '../../shared/library/parser'
import { NUMBER_PATTERN, parseNumber } from '../../shared/library/parser/cjk'

/** 全自动转存要的最低分 */
export const AUTO_SCORE = 70
/** 小于这个体积不要（预告、广告、样片） */
export const MIN_SIZE = 80 * 1024 * 1024
/** 大于这个体积不要（原盘、合集） */
export const MAX_SIZE = 25 * 1024 * 1024 * 1024

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

/** 认文件时用的偏好（体积已换成字节） */
export interface MatchPrefs {
  resolution: AutograbResolution
  preferWords: string[]
  excludeWords: string[]
  minSize: number
  maxSize: number
}

/** 首选分辨率命中加几分；是别的已知分辨率扣几分 */
const PREFERRED_RES_SCORE = 15
const OTHER_RES_PENALTY = 5
/** 每个偏好词加几分、最多加几分 */
const PREFER_WORD_SCORE = 6
const PREFER_WORD_MAX = 18

/** 没设偏好时的规则 */
export const DEFAULT_MATCH_PREFS: MatchPrefs = {
  resolution: 'any',
  preferWords: [],
  excludeWords: [],
  minSize: MIN_SIZE,
  maxSize: MAX_SIZE,
}

/** 界面上的偏好（MB）→ 认文件用的偏好（字节） */
export function matchPrefsOf(prefs: AutograbPrefs): MatchPrefs {
  const mb = 1024 * 1024
  return {
    resolution: prefs.resolution,
    preferWords: prefs.preferWords,
    excludeWords: prefs.excludeWords,
    minSize: prefs.minMb !== null ? prefs.minMb * mb : MIN_SIZE,
    maxSize: prefs.maxMb !== null ? prefs.maxMb * mb : MAX_SIZE,
  }
}

/** 认文件的结果 */
export type FileMatch =
  | { ok: true; score: number; reasons: string[] }
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

/** 文件名里的分辨率 */
function resolutionOf(name: string): Exclude<AutograbResolution, 'any'> | null {
  if (/2160p|4k|uhd/i.test(name)) return '2160p'
  if (/1080[pi]/i.test(name)) return '1080p'
  if (/720p/i.test(name)) return '720p'
  return null
}

const RES_LABEL = { '2160p': '4K', '1080p': '1080p', '720p': '720p' } as const
const RES_DEFAULT_SCORE = { '2160p': 10, '1080p': 8, '720p': 2 } as const

/** 分辨率加分：没有首选时越清晰越高；有首选时命中加分、别的分辨率扣分 */
function resolutionScore(
  name: string,
  preferred: AutograbResolution
): [number, string | null] {
  const res = resolutionOf(name)
  if (!res) return [0, null]
  if (preferred === 'any') return [RES_DEFAULT_SCORE[res], RES_LABEL[res]]
  return res === preferred
    ? [PREFERRED_RES_SCORE, `首选 ${RES_LABEL[res]}`]
    : [-OTHER_RES_PENALTY, RES_LABEL[res]]
}

/** 用户的词（不分大小写、按子串）在文字里命中哪些 */
function wordHits(words: string[], text: string): string[] {
  const lower = text.toLowerCase()
  return words.filter(w => lower.includes(w.toLowerCase()))
}

const SUB_RE = /中字|中文字幕|简中|繁中|简繁|双语|中英|字幕组|chs|cht/i
const SOURCE_RE = /web-?dl|webrip|blu-?ray|bdrip|remux/i

/**
 * 认一个文件。拒绝时给出理由（记进候选淘汰原因里），通过时给分数和加分理由。
 */
export function matchFile(
  file: ShareFileLike,
  target: EpisodeTarget,
  context: FileContext,
  prefs: MatchPrefs = DEFAULT_MATCH_PREFS
): FileMatch {
  if (file.isDir) return { ok: false, reason: '是文件夹' }
  if (!VIDEO_EXT_RE.test(file.name)) return { ok: false, reason: '不是视频' }
  const own = `${context.folder} ${file.name}`
  const excluded = excludedWord(own)
  if (excluded) return { ok: false, reason: `含「${excluded}」` }
  const userExcluded = wordHits(prefs.excludeWords, own)[0]
  if (userExcluded) return { ok: false, reason: `含排除词「${userExcluded}」` }
  if (file.size > 0 && file.size < prefs.minSize)
    return { ok: false, reason: '体积太小' }
  if (file.size > prefs.maxSize) return { ok: false, reason: '体积太大' }

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
  const ownTitle = titles.some(t => titleMatches(t, target.seriesTitle))
  if (!ownTitle && !titleMatches(context.shareTitle, target.seriesTitle))
    return { ok: false, reason: '剧名对不上' }

  const reasons: string[] = []
  let score = 50
  if (ownTitle) {
    score += 15
    reasons.push('文件名含剧名')
  }
  if (season !== undefined) {
    score += 5
    reasons.push(`第 ${season} 季`)
  }
  const [resolution, label] = resolutionScore(file.name, prefs.resolution)
  score += resolution
  if (label) reasons.push(label)
  const all = `${file.name} ${context.folder} ${context.shareTitle}`
  const liked = wordHits(prefs.preferWords, all)
  if (liked.length) {
    score += Math.min(PREFER_WORD_MAX, liked.length * PREFER_WORD_SCORE)
    reasons.push(...liked.map(w => `偏好「${w}」`))
  }
  if (SUB_RE.test(all)) {
    score += 8
    reasons.push('中文字幕')
  }
  if (SOURCE_RE.test(file.name)) {
    score += 3
    reasons.push('片源标注')
  }
  if (file.size >= 300 * 1024 * 1024 && file.size <= 8 * 1024 * 1024 * 1024) {
    score += 5
    reasons.push('体积正常')
  }
  return { ok: true, score: Math.max(0, Math.min(100, score)), reasons }
}

/** 分享里值得点进去看的子文件夹：名字对得上剧名、季号相符或是「第 N 季」这类季文件夹 */
export function folderWorthOpening(
  name: string,
  target: EpisodeTarget
): boolean {
  if (excludedWord(name)) return false
  const season = seasonIn(name)
  if (season !== undefined) return season === target.season
  return titleMatches(name, target.seriesTitle)
}
