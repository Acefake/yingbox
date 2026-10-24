/**
 * 渲染层的 AI 字幕任务状态（window.api.aiSubtitles）：全应用一份，按任务 id 存最新快照。
 * preload 的 off 会清掉全部监听，所以只在第一次使用时订阅一次 changed 事件。
 */
import { shallowRef } from 'vue'

import type {
  AiSubtitleJob,
  AiSubtitleRecord,
  AiSubtitleStartOptions,
} from '../../../../../shared/ai-subtitles/types'

const bridge = (): Window['api']['aiSubtitles'] | undefined =>
  typeof window !== 'undefined' ? window.api?.aiSubtitles : undefined

/** 任务快照（id → 任务）；整体替换以触发更新 */
const jobs = shallowRef<ReadonlyMap<string, AiSubtitleJob>>(new Map())
const finishHandlers = new Set<(job: AiSubtitleJob) => void>()
let subscribed = false

function put(job: AiSubtitleJob): void {
  const next = new Map(jobs.value)
  next.set(job.id, job)
  jobs.value = next
}

/** 订阅一次并拉一次现有任务 */
function ensureSubscribed(): void {
  const api = bridge()
  if (subscribed || !api) return
  subscribed = true
  api.onChanged(job => {
    put(job)
    if (job.phase === 'done' || job.phase === 'failed')
      finishHandlers.forEach(fn => fn(job))
  })
  void api
    .list()
    .then(list => list.forEach(put))
    .catch(() => {})
}

/** 当前环境能否用 AI 字幕（桌面端） */
export function aiSubtitlesAvailable(): boolean {
  return Boolean(bridge())
}

/** 全部任务（响应式） */
export function aiSubtitleJobs(): Readonly<typeof jobs> {
  ensureSubscribed()
  return jobs
}

/** 任务完成 / 失败时回调；返回退订函数 */
export function onAiSubtitleFinished(
  handler: (job: AiSubtitleJob) => void
): () => void {
  ensureSubscribed()
  finishHandlers.add(handler)
  return () => finishHandlers.delete(handler)
}

/** 为本地视频（local:// 地址）发起任务 */
export async function startAiSubtitle(
  source: string,
  options: AiSubtitleStartOptions
): Promise<AiSubtitleJob> {
  const api = bridge()
  if (!api) throw new Error('AI 字幕需要桌面端')
  ensureSubscribed()
  // 只传普通对象过 IPC
  const job = await api.start(source, {
    mode: options.mode,
    ...(options.private ? { private: true } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.language ? { language: options.language } : {}),
  })
  put(job)
  return job
}

/** 取消任务 */
export async function cancelAiSubtitle(id: string): Promise<boolean> {
  return (await bridge()?.cancel(id)) ?? false
}

/** 这个视频已生成的 AI 字幕 */
export async function findAiSubtitle(
  source: string
): Promise<AiSubtitleRecord | null> {
  try {
    return (await bridge()?.find(source)) ?? null
  } catch {
    return null
  }
}
