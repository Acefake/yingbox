/**
 * 追更偏好：首选分辨率、偏好词（加分）、排除词（命中即拒）、体积上下限。
 *
 * 两层：全局一份，每部剧可以覆盖其中几项。合并规则（{@link mergePrefs}）：
 * - 排除词两层叠加（全局排除的东西在每部剧里也排除）；
 * - 其余字段每部剧设了就用它的，没设跟随全局。
 *
 * 解析函数对任何输入都不抛错，认不出的字段丢掉：同一套既给契约边界用，也给读 autograb.json 用（兼容老文件）。
 */

/** 首选分辨率；any = 不偏好 */
export const AUTOGRAB_RESOLUTIONS = ['any', '2160p', '1080p', '720p'] as const
export type AutograbResolution = (typeof AUTOGRAB_RESOLUTIONS)[number]

/** 一份完整的偏好 */
export interface AutograbPrefs {
  resolution: AutograbResolution
  /** 命中加分的字幕组 / 片源关键词 */
  preferWords: string[]
  /** 命中就不要的词 */
  excludeWords: string[]
  /** 体积下限（MB）；null = 默认 80 MB */
  minMb: number | null
  /** 体积上限（MB）；null = 默认 25 GB */
  maxMb: number | null
}

/** 每部剧的覆盖：只写设了的字段 */
export type AutograbPrefsOverride = Partial<AutograbPrefs>

/** 每份词表最多几个词、每个词最长几个字 */
const MAX_WORDS = 20
const MAX_WORD_LENGTH = 40
/** 体积上下限的合法范围（MB）：1 MB – 200 GB */
const MAX_MB = 200 * 1024

/** 默认偏好：不偏好分辨率、没有自定义词、体积用内置范围 */
export const DEFAULT_PREFS: AutograbPrefs = {
  resolution: 'any',
  preferWords: [],
  excludeWords: [],
  minMb: null,
  maxMb: null,
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

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
export function prefsOverrideOf(raw: unknown): AutograbPrefsOverride {
  if (!isObj(raw)) return {}
  const out: AutograbPrefsOverride = {}
  if (AUTOGRAB_RESOLUTIONS.includes(raw.resolution as AutograbResolution))
    out.resolution = raw.resolution as AutograbResolution
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
export function prefsOf(raw: unknown): AutograbPrefs {
  return { ...DEFAULT_PREFS, ...prefsOverrideOf(raw) }
}

/** 全局 + 每剧覆盖 → 这部剧实际用的偏好 */
export function mergePrefs(
  global: AutograbPrefs,
  override: AutograbPrefsOverride | undefined
): AutograbPrefs {
  if (!override) return global
  const merged = { ...global, ...override }
  merged.excludeWords =
    wordsOf(
      [...global.excludeWords, ...(override.excludeWords ?? [])],
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
