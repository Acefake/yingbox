/**
 * AI 字幕面板的纯规则：任务状态文案、是否进行中、按视频取任务、输出模式选项。
 * 不依赖 Vue 与 window.api，测试直接调。
 */
import type {
  AiSubtitleJob,
  AiSubtitleMode,
} from '../../../../../shared/ai-subtitles/types'

/** 输出模式选项（UiSegmented 用） */
export const AI_SUBTITLE_MODE_OPTIONS: {
  value: AiSubtitleMode
  label: string
}[] = [
  { value: 'zh', label: '中文' },
  { value: 'bilingual', label: '双语' },
  { value: 'original', label: '原文' },
]

/** 任务是否还没结束（排队 / 识别 / 翻译） */
export function isJobActive(job: AiSubtitleJob | null | undefined): boolean {
  return (
    job?.phase === 'queued' ||
    job?.phase === 'recognizing' ||
    job?.phase === 'translating'
  )
}

/** 给用户看的状态：排队中 / 识别 x% / 翻译 x% / 已生成 / 失败原因 / 已取消 */
export function jobStatusText(job: AiSubtitleJob): string {
  switch (job.phase) {
    case 'queued':
      return '排队中'
    case 'recognizing':
      return `识别 ${job.percent}%`
    case 'translating':
      return `翻译 ${job.percent}%`
    case 'done':
      return '已生成并加载'
    case 'cancelled':
      return '已取消'
    default:
      return job.error ? `生成失败：${job.error}` : '生成失败'
  }
}

/** 进度条的值：识别占前 70%，翻译占后 30%（原文模式识别占满） */
export function jobOverallPercent(job: AiSubtitleJob): number {
  if (job.phase === 'done') return 100
  if (job.phase === 'queued') return 0
  const split = job.mode === 'original' ? 100 : 70
  if (job.phase === 'recognizing')
    return Math.round((job.percent * split) / 100)
  if (job.phase === 'translating')
    return Math.round(split + (job.percent * (100 - split)) / 100)
  return 0
}

/** 某个视频（local:// 地址）最新的任务 */
export function latestJobFor(
  jobs: Iterable<AiSubtitleJob>,
  source: string
): AiSubtitleJob | null {
  let best: AiSubtitleJob | null = null
  for (const job of jobs)
    if (job.source === source && (!best || job.createdAt >= best.createdAt))
      best = job
  return best
}

/** 字幕文件路径 → 菜单里显示的名字 */
export function subtitleDisplayName(path: string): string {
  const name = path.split(/[\\/]/).pop() || path
  return `AI · ${name.replace(/\.srt$/i, '')}`
}
