/**
 * 跳过片头片尾的纯规则：标记怎么存、某一时刻是否在片头 / 片尾、存储读回时的校验。
 *
 * - 片头按「开始秒 → 结束秒」记，同一部剧每集通用（大多数剧每集片头位置固定）；
 * - 片尾按「离结尾还有多少秒」记，这样每集时长不同也能对上；
 * - 标记以剧为单位：有「继续播放」记录 id 时用它，否则用片名。
 */

/** 片头区间（秒） */
export interface IntroMark {
  start: number
  end: number
}

/** 标记来源：手动标记 / 自动检测（自动结果不覆盖手动的，见 detect-merge.ts） */
export type SkipSource = 'manual' | 'auto'

/** 一部剧的片头片尾标记 */
export interface SkipMarks {
  intro?: IntroMark
  /** 片尾长度：最后多少秒算片尾 */
  outro?: number
  /** 片头来源；缺省按手动算（自动检测之前只有手动标记） */
  introSource?: SkipSource
  /** 片尾来源；缺省同上 */
  outroSource?: SkipSource
}

/** 存储里的一条记录 */
export interface SkipRecord extends SkipMarks {
  key: string
  updatedAt: number
}

/** 最多保留多少部剧的标记（按最近修改淘汰） */
export const MAX_SKIP_RECORDS = 300
/** 片头最短 / 最长（秒）：太短多半是误点，太长不像片头 */
export const MIN_INTRO = 5
export const MAX_INTRO = 600
/** 片尾最长（秒） */
export const MAX_OUTRO = 900
/** 距片头结束不足这么多秒就不再提示跳过（跳不跳差别不大） */
const INTRO_TAIL = 2

/**
 * 标记属于哪部剧。
 * @param continueId 「继续播放」记录 id（已按板块 + 条目区分）
 * @param title 片名（没有记录 id 时用）
 */
export function skipKey(continueId: string, title: string): string {
  if (continueId) return `c:${continueId}`
  const name = title.trim()
  return name ? `t:${name}` : ''
}

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0

/** 片头区间是否像样 */
export function validIntro(mark: IntroMark | undefined): mark is IntroMark {
  if (!mark || !finite(mark.start) || !finite(mark.end)) return false
  const len = mark.end - mark.start
  return len >= MIN_INTRO && len <= MAX_INTRO
}

/** 片尾长度是否像样 */
export function validOutro(outro: number | undefined): outro is number {
  return finite(outro) && outro >= MIN_INTRO && outro <= MAX_OUTRO
}

/**
 * 标记片头开始。已有结束点且仍在其后就保留，否则按 90 秒的常见片头长度给个结束点，
 * 用户再标结束即可修正。
 */
export function markIntroStart(marks: SkipMarks, time: number): SkipMarks {
  const start = Math.max(0, Math.floor(time))
  const oldEnd = marks.intro?.end
  const end =
    finite(oldEnd) && validIntro({ start, end: oldEnd }) ? oldEnd : start + 90
  return { ...marks, intro: { start, end } }
}

/** 标记片头结束。没标过开始时，从 0 秒算起。 */
export function markIntroEnd(marks: SkipMarks, time: number): SkipMarks {
  const end = Math.floor(time)
  const start = marks.intro && marks.intro.start < end ? marks.intro.start : 0
  const intro = { start, end }
  return validIntro(intro) ? { ...marks, intro } : marks
}

/** 标记片尾开始：记下离结尾还有多少秒。 */
export function markOutroStart(
  marks: SkipMarks,
  time: number,
  duration: number
): SkipMarks {
  if (!finite(duration) || duration <= 0) return marks
  const outro = Math.round(duration - time)
  return validOutro(outro) ? { ...marks, outro } : marks
}

/**
 * 当前是否在片头里；在的话返回该跳到的秒数，否则 null。
 * 片头最后两秒不算（跳不跳都一样，按钮一闪而过反而打扰）。
 */
export function introSkipTarget(marks: SkipMarks, time: number): number | null {
  const intro = marks.intro
  if (!validIntro(intro)) return null
  return time >= intro.start && time < intro.end - INTRO_TAIL ? intro.end : null
}

/** 片尾开始的秒数；没标或时长未知时 null。 */
export function outroStartAt(
  marks: SkipMarks,
  duration: number
): number | null {
  if (!validOutro(marks.outro) || !finite(duration)) return null
  const at = duration - marks.outro
  return at > 0 ? at : null
}

/** 当前是否在片尾里 */
export function inOutro(
  marks: SkipMarks,
  time: number,
  duration: number
): boolean {
  const at = outroStartAt(marks, duration)
  return at !== null && time >= at && time < duration
}

/**
 * 自动跳过片头的一步：返回要跳到的秒数（不跳为 null）与这一集是否已「用掉」自动跳过。
 *
 * 每集只自动跳一次：跳过之后，或者播放位置已经越过片头（例如续播在片头之后），
 * 用户再手动拖回片头就不再自动跳，只显示「跳过片头」按钮。
 * @param consumed 这一集是否已经用掉
 */
export function autoSkipStep(
  marks: SkipMarks,
  time: number,
  consumed: boolean
): { target: number | null; consumed: boolean } {
  if (consumed || !validIntro(marks.intro)) return { target: null, consumed }
  if (time >= marks.intro.end) return { target: null, consumed: true }
  const target = introSkipTarget(marks, time)
  return target === null ? { target, consumed } : { target, consumed: true }
}

/** 秒数写成 m:ss / h:mm:ss（提示文案用） */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 有没有任何标记 */
export const hasMarks = (marks: SkipMarks): boolean =>
  validIntro(marks.intro) || validOutro(marks.outro)

/** 进度条上要画的区间（占总时长的比例 0–1） */
export function markSpans(
  marks: SkipMarks,
  duration: number
): { kind: 'intro' | 'outro'; left: number; width: number }[] {
  if (!finite(duration) || duration <= 0) return []
  const spans: { kind: 'intro' | 'outro'; left: number; width: number }[] = []
  if (validIntro(marks.intro) && marks.intro.start < duration) {
    const end = Math.min(marks.intro.end, duration)
    spans.push({
      kind: 'intro',
      left: marks.intro.start / duration,
      width: (end - marks.intro.start) / duration,
    })
  }
  const at = outroStartAt(marks, duration)
  if (at !== null)
    spans.push({ kind: 'outro', left: at / duration, width: 1 - at / duration })
  return spans
}

/** 写入一条标记：新的放最前，空标记即删除，超出上限淘汰最旧的。 */
export function putRecord(
  records: readonly SkipRecord[],
  key: string,
  marks: SkipMarks,
  now: number
): SkipRecord[] {
  const rest = records.filter(r => r.key !== key)
  if (!key || !hasMarks(marks)) return rest
  const record: SkipRecord = { key, updatedAt: now }
  if (validIntro(marks.intro)) {
    record.intro = { ...marks.intro }
    if (marks.introSource) record.introSource = marks.introSource
  }
  if (validOutro(marks.outro)) {
    record.outro = marks.outro
    if (marks.outroSource) record.outroSource = marks.outroSource
  }
  return [record, ...rest].slice(0, MAX_SKIP_RECORDS)
}

const isSource = (value: unknown): value is SkipSource =>
  value === 'manual' || value === 'auto'

/** 读回存储时校验：形状不对的丢掉，不像样的单项去掉。 */
export function sanitizeSkipRecords(raw: unknown): SkipRecord[] {
  if (!Array.isArray(raw)) return []
  const out: SkipRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<SkipRecord>
    if (typeof r.key !== 'string' || !r.key) continue
    const record: SkipRecord = {
      key: r.key,
      updatedAt: finite(r.updatedAt) ? r.updatedAt : 0,
    }
    if (validIntro(r.intro)) {
      record.intro = { start: r.intro.start, end: r.intro.end }
      if (isSource(r.introSource)) record.introSource = r.introSource
    }
    if (validOutro(r.outro)) {
      record.outro = r.outro
      if (isSource(r.outroSource)) record.outroSource = r.outroSource
    }
    if (hasMarks(record)) out.push(record)
  }
  return out.slice(0, MAX_SKIP_RECORDS)
}
