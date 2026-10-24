/**
 * 媒体库「AI 识别」的界面规则（纯函数）：AI 是否配置好、开关说明文案、哪些条目能用 AI 识别、完成提示。
 *
 * 识别本身在媒体库引擎里（src/main/library/identify/ai），界面只发 identify({ ai: true }) 并等进度事件。
 */
import { aiProviderPreset } from '../../../../../shared/ai/providers'
import type { AiProviderId } from '../../../../../shared/ai/types'
import type {
  IdentifyProgressEvent,
  LibraryEvent,
  MatchState,
} from '../../../../../shared/library/ipc'
import type { LibrarySection } from '../state/library-section'

/** AI 是否配置好：需要 Key 的服务商要已保存 Key（Ollama 等本地服务不需要）。 */
export function aiScrapeReady(
  provider: AiProviderId,
  keyConfigured: boolean
): boolean {
  return !aiProviderPreset(provider).needsKey || keyConfigured
}

/** 设置开关下方的说明。 */
export function aiScrapeDescription(ready: boolean): string {
  return ready
    ? '文件名识别失败或把握不够时，让大模型从文件名和目录推断片名，再到 TMDB 核对标题与年份'
    : '需要先在「设置 → AI」里配置服务商与 API Key'
}

/** 分区能否用 AI 识别：番号按番号查站点，不走 TMDB，所以不提供。 */
export const sectionSupportsAi = (section: LibrarySection): boolean =>
  section !== 'jav'

/** 条目能否用 AI 识别：只有待确认 / 未匹配的。 */
export const stateSupportsAi = (state: MatchState | undefined): boolean =>
  state === 'review' || state === 'unmatched'

/** 一次 AI 识别（可能跨几个任务）的合计结果。 */
export type AiIdentifyTotals = Pick<
  IdentifyProgressEvent,
  'matched' | 'review' | 'unmatched' | 'failed' | 'error'
>

/** AI 识别完成的提示文案。 */
export function aiDoneText(event: AiIdentifyTotals): string {
  if (event.error) return `AI 识别中断：${event.error}`
  const parts = [`匹配 ${event.matched}`, `待确认 ${event.review}`]
  if (event.unmatched) parts.push(`仍未识别 ${event.unmatched}`)
  if (event.failed) parts.push(`失败 ${event.failed}`)
  return `AI 识别完成：${parts.join('，')}`
}

/** 合计几个任务的结束事件（任一出错时带上第一个错误）。 */
export function sumProgress(events: IdentifyProgressEvent[]): AiIdentifyTotals {
  const total = { matched: 0, review: 0, unmatched: 0, failed: 0 }
  let error: string | undefined
  for (const e of events) {
    total.matched += e.matched
    total.review += e.review
    total.unmatched += e.unmatched
    total.failed += e.failed
    error ??= e.error
  }
  return error ? { ...total, error } : total
}

/** 一个任务的结束：识别进度的最后一次事件，或任务失败 / 取消（没有进度事件时）。 */
export function terminalOf(event: LibraryEvent): IdentifyProgressEvent | null {
  if (event.type === 'identify-progress') return event.finished ? event : null
  if (event.type !== 'job' || event.jobType !== 'identify') return null
  if (event.state !== 'failed' && event.state !== 'cancelled') return null
  return {
    type: 'identify-progress',
    jobId: event.jobId,
    mode: 'identify',
    libraryId: null,
    total: 0,
    done: 0,
    matched: 0,
    review: 0,
    unmatched: 0,
    failed: 0,
    finished: true,
    error: event.error ?? (event.state === 'cancelled' ? '已取消' : '任务失败'),
  }
}
