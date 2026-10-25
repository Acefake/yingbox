/**
 * 按画面搜面板的纯规则：状态文案、要不要轮询、能不能搜、视频画面的时间点与播放请求。
 */
import type {
  VisualFramesStatus,
  VisualStatus,
} from '../../../../../shared/library/ipc'
import type { PlayRequest } from '../detail/playback'

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

/** 秒 → 时间点文案：「12:34」，一小时以上「1:02:03」。 */
export function clock(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 视频画面的一句话状态；没打开时为空。 */
export function framesText(frames: VisualFramesStatus): string {
  if (!frames.enabled) return ''
  if (frames.error) return frames.error
  const files = `${frames.indexed} / ${frames.total} 个视频`
  if (frames.paused) return `已暂停 · ${files}`
  if (frames.running) {
    const percent = Math.round((frames.progress ?? 0) * 100)
    return `正在抽帧 ${percent}% · ${files}`
  }
  if (frames.indexed < frames.total) return `空闲时抽帧 · ${files}`
  return `${files}已抽帧，共 ${frames.frames} 个画面`
}

/** 抽帧在进行（面板要轮询）。 */
export const framesBusy = (status: VisualStatus | null): boolean =>
  Boolean(status?.frames.running)

/**
 * 从某个文件的某个时间点播放：在电影的播放请求里定位到那个文件；文件已不在时为 null。
 */
export function momentRequest(
  request: PlayRequest | null,
  fileId: number,
  at: number
): PlayRequest | null {
  const index = request?.fileIds.indexOf(fileId) ?? -1
  if (!request || index < 0) return null
  // 动态范围跟着起始文件走（分段电影各段可能不同）
  const video = request.playlist[index]?.video
  return {
    title: request.title,
    playlist: request.playlist,
    fileIds: request.fileIds,
    item: request.item,
    index,
    startAt: at,
    ...(request.partial ? { partial: true } : {}),
    ...(video ? { video } : {}),
  }
}
