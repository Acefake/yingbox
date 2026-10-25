/**
 * 自动字幕的纯规则：判断视频是否已有中文字幕、挑哪一份、存成什么名字、失败后多久再试。
 *
 * 「已有中文字幕」认三处：
 * - 外挂：同目录、文件名以视频名开头的 srt / ass / ssa / vtt / sub，后缀里带中文语言标记
 *   （zh、chs、cht、chi、zho、sc、tc、简、繁、中文 等）；没有语言标记的同名字幕看内容是不是中文；
 * - 内封：ffprobe 的字幕流 language 是 chi / zho / zh，或标题写着中文 / 简 / 繁；
 * - 文件名本身写了中字 / 简中 / 繁中 / 中英 / 双语 / chs / cht（多半是硬字幕或内封）。
 */
import { basename, extname } from 'node:path'

/** 认作字幕的扩展名。 */
export const SUBTITLE_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub']

/** 语言后缀里的中文标记（按 . _ - 空格切开后逐段比，不区分大小写）。 */
const CHINESE_TOKENS = new Set([
  'zh',
  'zho',
  'chi',
  'chs',
  'cht',
  'sc',
  'tc',
  'cn',
  'gb',
  'big5',
  'hans',
  'hant',
  'chinese',
  'zh-cn',
  'zh-tw',
  'zh-hk',
  'zh-hans',
  'zh-hant',
  'chs&eng',
  'cht&eng',
])
const CHINESE_WORD = /[简繁中]|国语|國語|双语|雙語/

/** 视频文件名里说明自带中文字幕的字样。 */
const NAME_HAS_CHINESE =
  /中字|中英|简中|繁中|简体|繁體|繁体|双语|雙語|[\W_](?:chs|cht)(?:[\W_]|$)/i

/** 失败后的重试间隔：1 小时、6 小时、1 天（第一次之外再试三次）；之后不再试。 */
export const RETRY_DELAYS_MS = [3_600_000, 6 * 3_600_000, 24 * 3_600_000]

/** 视频名（不含扩展名）。 */
export function videoBase(videoPath: string): string {
  return basename(videoPath, extname(videoPath))
}

/** 语言后缀（视频名之后、扩展名之前的部分）是否标着中文。 */
export function suffixSaysChinese(suffix: string): boolean {
  if (CHINESE_WORD.test(suffix)) return true
  const lower = suffix.toLowerCase()
  if (CHINESE_TOKENS.has(lower.replace(/^[._\s-]+/, ''))) return true
  return lower.split(/[._\s]+/).some(part => CHINESE_TOKENS.has(part))
}

/** 同目录文件名的分类结果。 */
export interface SidecarScan {
  /** 带中文标记的同名字幕。 */
  chinese: string[]
  /** 没有语言标记的同名字幕（要看内容）。 */
  unlabeled: string[]
}

/** 在同目录文件名里找这个视频的字幕。 */
export function scanSidecars(
  videoPath: string,
  entries: string[]
): SidecarScan {
  const base = videoBase(videoPath).toLowerCase()
  const out: SidecarScan = { chinese: [], unlabeled: [] }
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    if (!SUBTITLE_EXTS.includes(ext)) continue
    const name = basename(entry, extname(entry))
    if (!name.toLowerCase().startsWith(base)) continue
    const suffix = name.slice(base.length)
    if (!suffix) out.unlabeled.push(entry)
    else if (suffixSaysChinese(suffix)) out.chinese.push(entry)
  }
  return out
}

/** 字幕正文是不是中文：汉字占字母类字符的三成以上。 */
export function textLooksChinese(text: string): boolean {
  const body = text.replace(/<[^>]*>|\{[^}]*\}|\d+:\d+:\d+[,.]\d+/g, '')
  const han = body.match(/\p{Script=Han}/gu)?.length ?? 0
  const letters = body.match(/\p{L}/gu)?.length ?? 0
  return letters > 0 && han / letters >= 0.3
}

/** 视频文件名是否说明自带中文字幕。 */
export function nameSaysChinese(videoPath: string): boolean {
  return NAME_HAS_CHINESE.test(videoBase(videoPath))
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/** `ffprobe -show_streams -of json` 的输出里有没有中文字幕流。 */
export function streamsHaveChinese(json: unknown): boolean {
  if (!isRecord(json) || !Array.isArray(json.streams)) return false
  return json.streams.some(stream => {
    if (!isRecord(stream) || stream.codec_type !== 'subtitle') return false
    const tags = isRecord(stream.tags) ? stream.tags : {}
    const lang = String(tags.language ?? '').toLowerCase()
    if (['chi', 'zho', 'zh', 'chs', 'cht'].includes(lang)) return true
    return /中|简|繁|chinese|chs|cht/i.test(String(tags.title ?? ''))
  })
}

/** OpenSubtitles 的一条候选（只留挑选要用的字段）。 */
export interface SubtitleHit {
  fileId: number
  /** zh-cn / zh-tw */
  language: string
  downloads: number
  /** 按文件哈希精确命中 */
  hashMatch: boolean
  /** 机器翻译 / AI 翻译 */
  machine: boolean
  hearingImpaired: boolean
  trusted: boolean
  release: string
}

/** 挑最合适的一份：只要人工中文字幕；哈希命中 > 简体 > 可信上传 > 下载量，听障版靠后。 */
export function pickSubtitle(hits: readonly SubtitleHit[]): SubtitleHit | null {
  const score = (hit: SubtitleHit): number =>
    (hit.hashMatch ? 1000 : 0) +
    (hit.language === 'zh-cn' ? 200 : 0) +
    (hit.trusted ? 50 : 0) -
    (hit.hearingImpaired ? 30 : 0) +
    Math.min(100, Math.log10(1 + hit.downloads) * 20)
  return (
    hits
      .filter(
        h => !h.machine && (h.language === 'zh-cn' || h.language === 'zh-tw')
      )
      .sort((a, b) => score(b) - score(a) || a.fileId - b.fileId)[0] ?? null
  )
}

/** 存放名（Kodi / Jellyfin 能认出语言）：简体 `<视频名>.zh.srt`，繁体 `<视频名>.zh-TW.srt`。 */
export function subtitleFileName(videoPath: string, language: string): string {
  return `${videoBase(videoPath)}.${language === 'zh-tw' ? 'zh-TW' : 'zh'}.srt`
}

/** 第 attempts 次失败后下一次什么时候试；用完次数返回 null。 */
export function nextRetry(attempts: number, now: number): number | null {
  const delay = RETRY_DELAYS_MS[attempts - 1]
  return delay === undefined ? null : now + delay
}

/** 本地日期 YYYY-MM-DD（每日上限按它清零）。 */
export function localDay(now: number): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 下一个本地零点。 */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}
