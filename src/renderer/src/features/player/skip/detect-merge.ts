/**
 * 自动检测结果并入片头片尾标记的纯规则：
 *
 * - 手动优先：已有手动标的片头（或片尾），自动结果不覆盖；自动结果可以覆盖之前的自动结果；
 * - 片头、片尾分开算来源：手动只标了片头时，片尾仍可由自动检测补上；
 * - 手动编辑时，改动的那一项记为手动，没动的那一项保留原来源（stampManual）；
 * - 没有来源字段的老记录一律按手动算。
 */
import {
  type IntroMark,
  type SkipMarks,
  type SkipSource,
  formatClock,
  validIntro,
  validOutro,
} from './skip-rules'

/** 自动检测给出的结论（秒） */
export interface DetectedMarks {
  intro?: IntroMark
  outro?: number
}

/** 某一项标记的来源；没有这项标记时为 null */
export function sourceOf(
  marks: SkipMarks,
  part: 'intro' | 'outro'
): SkipSource | null {
  if (part === 'intro')
    return validIntro(marks.intro) ? (marks.introSource ?? 'manual') : null
  return validOutro(marks.outro) ? (marks.outroSource ?? 'manual') : null
}

/** 手动写入：和原来不同的项记为手动，相同的项保留原来源。 */
export function stampManual(prev: SkipMarks, next: SkipMarks): SkipMarks {
  const out: SkipMarks = {}
  if (validIntro(next.intro)) {
    out.intro = { ...next.intro }
    const same =
      prev.intro?.start === next.intro.start &&
      prev.intro?.end === next.intro.end
    out.introSource = same ? (sourceOf(prev, 'intro') ?? 'manual') : 'manual'
  }
  if (validOutro(next.outro)) {
    out.outro = next.outro
    out.outroSource =
      prev.outro === next.outro
        ? (sourceOf(prev, 'outro') ?? 'manual')
        : 'manual'
  }
  return out
}

/** 并入结果：新的标记，以及片头 / 片尾各自是采用了、因手动而保留、还是没检测到 */
export interface MergeOutcome {
  marks: SkipMarks
  intro: 'applied' | 'kept-manual' | 'none'
  outro: 'applied' | 'kept-manual' | 'none'
}

/** 把检测结论并入现有标记（手动优先）。 */
export function mergeDetected(
  prev: SkipMarks,
  found: DetectedMarks
): MergeOutcome {
  const marks: SkipMarks = {}
  if (validIntro(prev.intro)) {
    marks.intro = { ...prev.intro }
    marks.introSource = sourceOf(prev, 'intro')!
  }
  if (validOutro(prev.outro)) {
    marks.outro = prev.outro
    marks.outroSource = sourceOf(prev, 'outro')!
  }
  let intro: MergeOutcome['intro'] = 'none'
  if (validIntro(found.intro)) {
    if (marks.introSource === 'manual') intro = 'kept-manual'
    else {
      marks.intro = { start: found.intro.start, end: found.intro.end }
      marks.introSource = 'auto'
      intro = 'applied'
    }
  }
  let outro: MergeOutcome['outro'] = 'none'
  if (validOutro(found.outro)) {
    if (marks.outroSource === 'manual') outro = 'kept-manual'
    else {
      marks.outro = found.outro
      marks.outroSource = 'auto'
      outro = 'applied'
    }
  }
  return { marks, intro, outro }
}

/** 是否值得检测：片头或片尾还缺（手动、自动都没有）。播放时自动检测用。 */
export function needsDetection(marks: SkipMarks): boolean {
  return sourceOf(marks, 'intro') === null || sourceOf(marks, 'outro') === null
}

/** 检测结束后给人看的一句话 */
export function mergeSummary(outcome: MergeOutcome): string {
  const parts: string[] = []
  const { marks } = outcome
  if (outcome.intro === 'applied' && marks.intro)
    parts.push(
      `片头 ${formatClock(marks.intro.start)} – ${formatClock(marks.intro.end)}`
    )
  if (outcome.outro === 'applied' && marks.outro !== undefined)
    parts.push(`片尾最后 ${formatClock(marks.outro)}`)
  const kept =
    outcome.intro === 'kept-manual' || outcome.outro === 'kept-manual'
  if (parts.length)
    return `已检测到${parts.join('，')}${kept ? '（手动标记保持不变）' : ''}`
  if (kept) return '检测结果与手动标记重叠，手动标记保持不变'
  return '没有找到各集共同的片头片尾'
}
