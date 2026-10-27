/**
 * 追更策略与资源偏好的界面纯规则：各项的选项文字、「跟随全局」选项、词表与文本互转、体积 MB 与输入框里 GB 互转、
 * 偏好 / 覆盖项的一句话摘要、每行「跟随 / 单独设」胶囊上的文字，以及覆盖表单与偏好之间的互转。
 * 设置 · 自动追更、追更面板、电影追踪面板共用。
 */
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
  type GrabPrefsOverride,
  type GrabResolution,
  type GrabStrategy,
  type GrabSubs,
  type GrabTri,
} from '../../../../shared/contract/grab-prefs'
import type {
  GrabMode,
  GrabModeSetting,
} from '../../../../shared/contract/grab-policy'

/** 一个选项（玻璃下拉 / 分段控件都用这个形状） */
export interface PrefOption<V extends string> {
  value: V
  label: string
  title?: string
}

/** 剧集的追更方式 */
export const TV_MODE_OPTIONS: PrefOption<GrabMode>[] = [
  { value: 'off', label: '不追' },
  { value: 'confirm', label: '待确认' },
  { value: 'auto', label: '全自动' },
]

/** 电影的追更方式（电影没有「不追」：不想要就移出追踪） */
export const MOVIE_MODE_OPTIONS: PrefOption<GrabMode>[] = [
  { value: 'confirm', label: '待确认' },
  { value: 'auto', label: '全自动' },
]

/** 新剧先确认几集（分段控件只收字符串） */
export const CONFIRM_FIRST_OPTIONS: PrefOption<'0' | '1' | '3'>[] = [
  { value: '0', label: '不用' },
  { value: '1', label: '1 集' },
  { value: '3', label: '3 集' },
]

/** 版本取向 */
export const STRATEGY_OPTIONS: PrefOption<GrabStrategy>[] = [
  {
    value: 'quality',
    label: '画质优先',
    title: '分辨率、片源、杜比视界优先，体积大些也行',
  },
  { value: 'balanced', label: '均衡' },
  {
    value: 'compact',
    label: '省空间',
    title: '够清楚就行，HEVC 加分、原盘扣分',
  },
]

/** 首选分辨率 */
export const RESOLUTION_OPTIONS: PrefOption<GrabResolution>[] = [
  { value: 'any', label: '不限' },
  { value: '2160p', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
]

/** 最低分辨率（低于它的不要） */
export const MIN_RESOLUTION_OPTIONS: PrefOption<GrabResolution>[] = [
  { value: 'any', label: '不限' },
  { value: '2160p', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
]

/** 杜比视界 / HDR */
export const TRI_OPTIONS: PrefOption<GrabTri>[] = [
  { value: 'any', label: '不限' },
  { value: 'prefer', label: '优先' },
  { value: 'avoid', label: '避开' },
]

/** 中文字幕 */
export const SUBS_OPTIONS: PrefOption<GrabSubs>[] = [
  { value: 'any', label: '不限' },
  { value: 'prefer', label: '优先' },
  { value: 'require', label: '必须' },
]

/** 选项值 → 文字（认不出时原样） */
export function optionLabel<V extends string>(
  options: readonly PrefOption<V>[],
  value: V
): string {
  return options.find(o => o.value === value)?.label ?? value
}

/** 覆盖表单里的选项：前面加一个「跟随」，悬停提示写全局值 */
export function withInherit<V extends string>(
  options: readonly PrefOption<V>[],
  global: V
): PrefOption<V | 'inherit'>[] {
  return [
    {
      value: 'inherit',
      label: '跟随',
      title: `跟随全局（${optionLabel(options, global)}）`,
    },
    ...options,
  ]
}

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

/** 杜比视界 / HDR / 中字的简写（不限时为空） */
function flagParts(p: GrabPrefsOverride): string[] {
  const parts: string[] = []
  if (p.dolbyVision === 'prefer') parts.push('优先 DV')
  if (p.dolbyVision === 'avoid') parts.push('避开 DV')
  if (p.hdr === 'prefer') parts.push('优先 HDR')
  if (p.hdr === 'avoid') parts.push('避开 HDR')
  if (p.chineseSubs === 'prefer') parts.push('优先中字')
  if (p.chineseSubs === 'require') parts.push('必须中字')
  return parts
}

/** 全局偏好的一句话摘要：取向 · 首选分辨率 · 杜比视界 / HDR / 中字（不限的不写） */
export function prefsSummary(p: GrabPrefs): string {
  const parts = [optionLabel(STRATEGY_OPTIONS, p.strategy)]
  if (p.resolution !== 'any')
    parts.push(optionLabel(RESOLUTION_OPTIONS, p.resolution))
  return [...parts, ...flagParts(p)].join(' · ')
}

/** 每部覆盖项的一句话摘要；没覆盖时为空串 */
export function overrideSummary(o: GrabPrefsOverride): string {
  const parts: string[] = []
  if (o.strategy) parts.push(optionLabel(STRATEGY_OPTIONS, o.strategy))
  if (o.resolution && o.resolution !== 'any')
    parts.push(optionLabel(RESOLUTION_OPTIONS, o.resolution))
  if (o.minResolution && o.minResolution !== 'any')
    parts.push(`至少 ${optionLabel(MIN_RESOLUTION_OPTIONS, o.minResolution)}`)
  parts.push(...flagParts(o))
  if (o.preferWords?.length) parts.push(`偏好 ${o.preferWords.join('、')}`)
  if (o.excludeWords?.length) parts.push(`排除 ${o.excludeWords.join('、')}`)
  if (o.minMb != null || o.maxMb != null) parts.push('体积')
  return parts.join(' · ')
}

/** 一部剧 / 电影算不算「单独设」：单独设了方式，或覆盖了任何资源偏好 */
export function isCustom(
  setting: GrabModeSetting,
  override: GrabPrefsOverride
): boolean {
  return setting !== 'inherit' || Object.keys(override).length > 0
}

/** 每行「跟随 / 单独设」胶囊上的文字：跟随 · 全自动 / 单独 · 待确认 */
export function itemPolicyText(custom: boolean, effective: GrabMode): string {
  const label = optionLabel(TV_MODE_OPTIONS, effective)
  return custom ? `单独 · ${label}` : `跟随 · ${label}`
}

/** 覆盖表单：选项字段可为「跟随」，文本字段空着为跟随 */
export interface PrefsDraft {
  strategy: GrabStrategy | 'inherit'
  resolution: GrabResolution | 'inherit'
  minResolution: GrabResolution | 'inherit'
  dolbyVision: GrabTri | 'inherit'
  hdr: GrabTri | 'inherit'
  chineseSubs: GrabSubs | 'inherit'
  prefer: string
  exclude: string
  min: string
  max: string
}

/** 表单里的选项字段 */
export const DRAFT_SELECT_KEYS = [
  'strategy',
  'resolution',
  'minResolution',
  'dolbyVision',
  'hdr',
  'chineseSubs',
] as const

/** 每部覆盖 → 表单（没设的字段为「跟随」/ 空） */
export function draftOfOverride(o: GrabPrefsOverride): PrefsDraft {
  return {
    strategy: o.strategy ?? 'inherit',
    resolution: o.resolution ?? 'inherit',
    minResolution: o.minResolution ?? 'inherit',
    dolbyVision: o.dolbyVision ?? 'inherit',
    hdr: o.hdr ?? 'inherit',
    chineseSubs: o.chineseSubs ?? 'inherit',
    prefer: wordsText(o.preferWords),
    exclude: wordsText(o.excludeWords),
    min: gbText(o.minMb),
    max: gbText(o.maxMb),
  }
}

/** 表单 → 每部覆盖：「跟随」与空的字段不写 */
export function overrideOfDraft(d: PrefsDraft): GrabPrefsOverride {
  const o: Record<string, unknown> = {}
  for (const key of DRAFT_SELECT_KEYS) if (d[key] !== 'inherit') o[key] = d[key]
  const prefer = parseWords(d.prefer)
  if (prefer.length) o.preferWords = prefer
  const exclude = parseWords(d.exclude)
  if (exclude.length) o.excludeWords = exclude
  const min = parseGb(d.min)
  if (min !== null) o.minMb = min
  const max = parseGb(d.max)
  if (max !== null) o.maxMb = max
  return o as GrabPrefsOverride
}

/**
 * 全局偏好改一个字段后的整份偏好（设置分区即改即存用）。
 * 词表字段收输入框文本，体积字段收 GB 文本。
 */
export function patchPrefs(
  base: GrabPrefs = DEFAULT_GRAB_PREFS,
  patch: Partial<Pick<PrefsDraft, 'prefer' | 'exclude' | 'min' | 'max'>> &
    Partial<GrabPrefs>
): GrabPrefs {
  const { prefer, exclude, min, max, ...fields } = patch
  const next: GrabPrefs = { ...base, ...fields }
  if (prefer !== undefined) next.preferWords = parseWords(prefer)
  if (exclude !== undefined) next.excludeWords = parseWords(exclude)
  if (min !== undefined) next.minMb = parseGb(min)
  if (max !== undefined) next.maxMb = parseGb(max)
  return next
}
