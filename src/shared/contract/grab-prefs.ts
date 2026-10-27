/**
 * 资源偏好：自动找资源时挑哪个版本（剧集追更、电影追踪、洗版共用一套字段）。
 *
 * - 取向：画质优先 / 均衡 / 省空间，决定版本分怎么加权（见 shared/release/score.ts）；
 * - 首选分辨率加分，最低分辨率是硬过滤；杜比视界、HDR 可以优先或避开；中文字幕可以优先或必须有；
 * - 偏好词加分，排除词命中即拒，体积上下限（MB，null = 按种类默认：剧集 80 MB–25 GB、电影 500 MB–80 GB）。
 *
 * 两层：一份完整偏好 + 单部覆盖（只写设了的字段）。合并规则（{@link mergePrefs}）：
 * 排除词两层叠加，其余字段覆盖层设了就用它的。
 *
 * 解析函数对任何输入都不抛错，认不出的字段丢掉：同一套既给契约边界用，也给读状态文件用（兼容老文件）。
 */

/** 分辨率选项；any = 不限 */
export const GRAB_RESOLUTIONS = ['any', '2160p', '1080p', '720p'] as const
export type GrabResolution = (typeof GRAB_RESOLUTIONS)[number]

/** 版本取向：画质优先 / 均衡 / 省空间 */
export const GRAB_STRATEGIES = ['quality', 'balanced', 'compact'] as const
export type GrabStrategy = (typeof GRAB_STRATEGIES)[number]

/** 杜比视界 / HDR：不限 / 优先 / 避开 */
export const GRAB_TRI = ['any', 'prefer', 'avoid'] as const
export type GrabTri = (typeof GRAB_TRI)[number]

/** 中文字幕：不限 / 优先 / 必须 */
export const GRAB_SUBS = ['any', 'prefer', 'require'] as const
export type GrabSubs = (typeof GRAB_SUBS)[number]

/** 一份完整的资源偏好 */
export interface GrabPrefs {
  strategy: GrabStrategy
  /** 首选分辨率（加分） */
  resolution: GrabResolution
  /** 最低分辨率（低于它的不要；认不出分辨率的不拦） */
  minResolution: GrabResolution
  dolbyVision: GrabTri
  hdr: GrabTri
  chineseSubs: GrabSubs
  /** 命中加分的字幕组 / 片源关键词 */
  preferWords: string[]
  /** 命中就不要的词 */
  excludeWords: string[]
  /** 体积下限（MB）；null = 按种类默认 */
  minMb: number | null
  /** 体积上限（MB）；null = 按种类默认 */
  maxMb: number | null
}

/** 单部覆盖：只写设了的字段 */
export type GrabPrefsOverride = Partial<GrabPrefs>

/** 每份词表最多几个词、每个词最长几个字 */
const MAX_WORDS = 20
const MAX_WORD_LENGTH = 40
/** 体积上下限的合法范围（MB）：1 MB – 200 GB */
const MAX_MB = 200 * 1024

/** 默认偏好：均衡、分辨率不限、杜比视界 / HDR / 中字不限、没有自定义词、体积按种类默认 */
export const DEFAULT_GRAB_PREFS: GrabPrefs = {
  strategy: 'balanced',
  resolution: 'any',
  minResolution: 'any',
  dolbyVision: 'any',
  hdr: 'any',
  chineseSubs: 'any',
  preferWords: [],
  excludeWords: [],
  minMb: null,
  maxMb: null,
}

/** 分辨率选项 → 高度；any 为 null */
export function resolutionHeight(res: GrabResolution): number | null {
  return res === 'any' ? null : Number(res.slice(0, -1))
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  list.includes(v as T)

/** 词表：去空白、去重（不分大小写）、限长限量；不是数组时为 undefined */
export function wordsOf(raw: unknown, limit = MAX_WORDS): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const word = item.trim().slice(0, MAX_WORD_LENGTH)
    const key = word.toLowerCase()
    if (!word || seen.has(key)) continue
    seen.add(key)
    out.push(word)
    if (out.length >= limit) break
  }
  return out
}

/** 体积（MB）：1 – 200 GB 的整数；null 表示用默认；其它为 undefined（丢掉） */
function mbOf(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const mb = Math.round(raw)
  return mb >= 1 && mb <= MAX_MB ? mb : undefined
}

/** 任意值 → 覆盖项（只留认得出的字段；下限不小于上限时丢掉下限） */
export function prefsOverrideOf(raw: unknown): GrabPrefsOverride {
  if (!isObj(raw)) return {}
  const out: GrabPrefsOverride = {}
  if (oneOf(GRAB_STRATEGIES, raw.strategy)) out.strategy = raw.strategy
  if (oneOf(GRAB_RESOLUTIONS, raw.resolution)) out.resolution = raw.resolution
  if (oneOf(GRAB_RESOLUTIONS, raw.minResolution))
    out.minResolution = raw.minResolution
  if (oneOf(GRAB_TRI, raw.dolbyVision)) out.dolbyVision = raw.dolbyVision
  if (oneOf(GRAB_TRI, raw.hdr)) out.hdr = raw.hdr
  if (oneOf(GRAB_SUBS, raw.chineseSubs)) out.chineseSubs = raw.chineseSubs
  const prefer = wordsOf(raw.preferWords)
  if (prefer) out.preferWords = prefer
  const exclude = wordsOf(raw.excludeWords)
  if (exclude) out.excludeWords = exclude
  const min = mbOf(raw.minMb)
  if (min !== undefined) out.minMb = min
  const max = mbOf(raw.maxMb)
  if (max !== undefined) out.maxMb = max
  if (
    typeof out.minMb === 'number' &&
    typeof out.maxMb === 'number' &&
    out.minMb >= out.maxMb
  )
    delete out.minMb
  return out
}

/** 任意值 → 完整偏好（缺的字段用默认） */
export function prefsOf(raw: unknown): GrabPrefs {
  return { ...DEFAULT_GRAB_PREFS, ...prefsOverrideOf(raw) }
}

/** 完整偏好 + 单部覆盖 → 实际用的偏好 */
export function mergePrefs(
  base: GrabPrefs,
  override: GrabPrefsOverride | undefined
): GrabPrefs {
  if (!override) return base
  const merged = { ...base, ...override }
  merged.excludeWords =
    wordsOf(
      [...base.excludeWords, ...(override.excludeWords ?? [])],
      MAX_WORDS * 2
    ) ?? []
  if (
    merged.minMb !== null &&
    merged.maxMb !== null &&
    merged.minMb >= merged.maxMb
  )
    merged.minMb = null
  return merged
}
