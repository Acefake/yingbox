/**
 * 按画面搜面板的纯规则：状态文案、要不要轮询、能不能搜。
 */
import type { VisualStatus } from '../../../../../shared/library/ipc'

/** 模型大小（下载提示用，与引擎 clip-model-files 的量化模型一致）。 */
export const MODEL_SIZE_LABEL = '约 190 MB'

/** 面板所处阶段。 */
export type VisualStage = 'unavailable' | 'setup' | 'working' | 'ready'

/** 状态 → 阶段：不可用 / 需要下载建索引 / 正在下载或索引 / 可以搜。 */
export function stageOf(status: VisualStatus | null): VisualStage {
  if (!status) return 'setup'
  if (!status.runtime) return 'unavailable'
  if (status.indexing) return 'working'
  if (status.model !== 'ready' || status.indexed === 0) return 'setup'
  return 'ready'
}

/** 进行中的一句话说明。 */
export function progressText(status: VisualStatus): string {
  const percent = Math.round((status.progress ?? 0) * 100)
  if (status.model === 'downloading') return `正在下载模型 ${percent}%`
  return `正在建立索引 ${percent}% · 已完成 ${status.indexed} / ${status.total} 部`
}

/** 还有没索引的片（新识别的、上次没取到图的）。 */
export const hasPending = (status: VisualStatus): boolean =>
  status.indexed < status.total

/** 示例描述（空输入时的提示）。 */
export const EXAMPLES = ['高跟鞋', '黑色丝袜', '办公室', '泳装', '和服']
