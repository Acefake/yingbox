/**
 * 追更偏好表单的纯规则：词表与文本互转、体积 MB 与输入框里 GB 互转、分辨率选项、覆盖项摘要。
 */
import {
  type AutograbPrefs,
  type AutograbPrefsOverride,
  type AutograbResolution,
  DEFAULT_PREFS,
} from '../../../../shared/contract/autograb-prefs'

/** 分辨率选项 */
export const RESOLUTION_OPTIONS: {
  value: AutograbResolution
  label: string
}[] = [
  { value: 'any', label: '任意' },
  { value: '2160p', label: '2160p' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
]

/** 词表 → 输入框文本（逗号分隔） */
export function wordsText(words: readonly string[] | undefined): string {
  return (words ?? []).join('，')
}

/** 输入框文本 → 词表（中英文逗号、顿号、空白都算分隔） */
export function parseWords(text: string): string[] {
  return text
    .split(/[,，、;；\s]+/)
    .map(w => w.trim())
    .filter(Boolean)
}

/** MB → 输入框里的 GB 文本（null 为空串） */
export function gbText(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return ''
  return String(Math.round((mb / 1024) * 100) / 100)
}

/** 输入框里的 GB 文本 → MB；空或不是正数为 null */
export function parseGb(text: string): number | null {
  const gb = Number(text.trim())
  if (!text.trim() || !Number.isFinite(gb) || gb <= 0) return null
  return Math.max(1, Math.round(gb * 1024))
}

/** 每剧覆盖项的一句话摘要；没覆盖时为空串 */
export function overrideSummary(o: AutograbPrefsOverride): string {
  const parts: string[] = []
  if (o.resolution && o.resolution !== 'any') parts.push(o.resolution)
  if (o.preferWords?.length) parts.push(`偏好 ${o.preferWords.join('、')}`)
  if (o.excludeWords?.length) parts.push(`排除 ${o.excludeWords.join('、')}`)
  if (o.minMb != null || o.maxMb != null) parts.push('体积')
  return parts.join(' · ')
}

/** 表单里的文本字段 */
export interface PrefsDraft {
  resolution: AutograbResolution | 'inherit'
  prefer: string
  exclude: string
  min: string
  max: string
}

/** 全局偏好 → 表单 */
export function draftOfPrefs(p: AutograbPrefs): PrefsDraft {
  return {
    resolution: p.resolution,
    prefer: wordsText(p.preferWords),
    exclude: wordsText(p.excludeWords),
    min: gbText(p.minMb),
    max: gbText(p.maxMb),
  }
}

/** 每剧覆盖 → 表单（没设的字段为「跟随全局」/ 空） */
export function draftOfOverride(o: AutograbPrefsOverride): PrefsDraft {
  return {
    resolution: o.resolution ?? 'inherit',
    prefer: wordsText(o.preferWords),
    exclude: wordsText(o.excludeWords),
    min: gbText(o.minMb),
    max: gbText(o.maxMb),
  }
}

/**
 * 表单 → 全局偏好。
 * @param base 表单里没有的字段从这里带上（取向、杜比视界等）
 */
export function prefsOfDraft(
  d: PrefsDraft,
  base: AutograbPrefs = DEFAULT_PREFS
): AutograbPrefs {
  return {
    ...base,
    resolution: d.resolution === 'inherit' ? 'any' : d.resolution,
    preferWords: parseWords(d.prefer),
    excludeWords: parseWords(d.exclude),
    minMb: parseGb(d.min),
    maxMb: parseGb(d.max),
  }
}

/** 表单 → 每剧覆盖：空的字段不写（跟随全局） */
export function overrideOfDraft(d: PrefsDraft): AutograbPrefsOverride {
  const o: AutograbPrefsOverride = {}
  if (d.resolution !== 'inherit') o.resolution = d.resolution
  const prefer = parseWords(d.prefer)
  if (prefer.length) o.preferWords = prefer
  const exclude = parseWords(d.exclude)
  if (exclude.length) o.excludeWords = exclude
  const min = parseGb(d.min)
  if (min !== null) o.minMb = min
  const max = parseGb(d.max)
  if (max !== null) o.maxMb = max
  return o
}
