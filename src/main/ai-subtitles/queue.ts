/**
 * AI 字幕任务队列：一次只跑一个（识别吃满 CPU / 显卡），其余排队；可取消排队中或进行中的任务。
 * 同一视频已有排队 / 进行中的任务时不重复加。进度只在整数百分比变化时推送。
 * 不依赖 Electron：任务怎么跑由 run 注入，状态变化经 emit 发出。
 */
import type {
  AiSubtitleJob,
  AiSubtitleStartOptions,
} from '../../shared/ai-subtitles/types'
import type { PipelineProgress } from './pipeline'

/** 最近结束的任务保留几条 */
export const FINISHED_LIMIT = 20

/** 跑一个任务；返回输出路径与语言 */
export type JobRunner = (
  job: Readonly<AiSubtitleJob>,
  context: { signal: AbortSignal; onProgress: PipelineProgress }
) => Promise<{ outputPath: string; language: string }>

/** 队列依赖 */
export interface QueueDeps {
  run: JobRunner
  emit: (job: AiSubtitleJob) => void
  now?: () => number
  newId?: () => string
}

/** 任务队列 */
export interface AiSubtitleQueue {
  add(
    source: string,
    videoPath: string,
    options: AiSubtitleStartOptions
  ): AiSubtitleJob
  cancel(id: string): boolean
  list(): AiSubtitleJob[]
  /** 取消全部（应用退出时） */
  cancelAll(): void
  /** 当前队列跑空后 resolve（测试与退出时用） */
  idle(): Promise<void>
}

/** 错误转成给用户看的一句话（去掉 AI 错误码前缀） */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^.*?\[ai:[a-z_]+\] /, '') || '生成失败'
}

/** 是否是取消 */
function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  const err = error as { name?: unknown; code?: unknown } | null
  return err?.name === 'AbortError' || err?.code === 'cancelled'
}

/** 创建队列 */
export function createAiSubtitleQueue(deps: QueueDeps): AiSubtitleQueue {
  const now = deps.now ?? Date.now
  let seq = 0
  const newId = deps.newId ?? (() => `aisub-${now()}-${++seq}`)
  const pending: AiSubtitleJob[] = []
  const finished: AiSubtitleJob[] = []
  let current: { job: AiSubtitleJob; controller: AbortController } | null = null
  let running: Promise<void> = Promise.resolve()

  const publish = (job: AiSubtitleJob): void => {
    job.updatedAt = now()
    deps.emit({ ...job })
  }

  const finish = (job: AiSubtitleJob): void => {
    finished.unshift(job)
    finished.length = Math.min(finished.length, FINISHED_LIMIT)
    publish(job)
  }

  const runOne = async (job: AiSubtitleJob): Promise<void> => {
    const controller = new AbortController()
    current = { job, controller }
    job.phase = 'recognizing'
    job.percent = 0
    publish(job)
    try {
      const result = await deps.run(
        { ...job },
        {
          signal: controller.signal,
          onProgress: (phase, percent) => {
            const value = Math.max(0, Math.min(100, Math.floor(percent)))
            if (job.phase === phase && job.percent === value) return
            job.phase = phase
            job.percent = value
            publish(job)
          },
        }
      )
      job.phase = 'done'
      job.percent = 100
      job.outputPath = result.outputPath
      job.language = result.language
    } catch (error) {
      if (isAbort(error, controller.signal)) job.phase = 'cancelled'
      else {
        job.phase = 'failed'
        job.error = errorText(error)
      }
    } finally {
      current = null
    }
    finish(job)
  }

  const pump = (): void => {
    running = running.then(async () => {
      while (!current && pending.length) await runOne(pending.shift()!)
    })
  }

  return {
    add(source, videoPath, options) {
      const existing = [current?.job, ...pending].find(
        job => job?.videoPath === videoPath
      )
      if (existing) return { ...existing }
      const job: AiSubtitleJob = {
        id: newId(),
        source,
        videoPath,
        title: options.title ?? '',
        mode: options.mode,
        private: options.private === true,
        phase: 'queued',
        percent: 0,
        language: options.language ?? '',
        createdAt: now(),
        updatedAt: now(),
      }
      pending.push(job)
      publish(job)
      pump()
      return { ...job }
    },

    cancel(id) {
      if (current?.job.id === id) {
        current.controller.abort()
        return true
      }
      const index = pending.findIndex(job => job.id === id)
      if (index < 0) return false
      const [job] = pending.splice(index, 1)
      job.phase = 'cancelled'
      finish(job)
      return true
    },

    list() {
      return [current?.job, ...pending, ...finished]
        .filter((job): job is AiSubtitleJob => Boolean(job))
        .map(job => ({ ...job }))
    },

    cancelAll() {
      for (const job of [...pending]) this.cancel(job.id)
      current?.controller.abort()
    },

    idle: () => running,
  }
}
