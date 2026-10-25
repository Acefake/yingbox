/**
 * 视频关键帧索引：从本地视频按计划抽帧（frame-rules.planFrames）→ 批量 CLIP 编码 → 去掉相近帧 → 入库，
 * 小缩略图放进图片缓存的 orig/（和封面同一套 yingbox-media://image/<key> 地址，桌面端与网页端都能直接显示）。
 *
 * 调度：
 * - 低优先级任务 visual-frames（排在识别后补索引之后），用户打开「视频画面」才排；
 * - 空闲时跑：每批开工前看队列里有没有别的任务在跑或待跑，有就停下，过一会儿再排；
 * - 暂停 / 关掉：取消正在跑的任务（ffmpeg 随之结束），已抽的批次留着；
 * - 断点续跑：每批入库时记下计划里处理到第几帧，下次从那里接着抽（引擎重启、暂停后继续都一样）；
 * - 网盘上的库默认跳过（设置可开）；远程源（WebDAV / Alist）没有本地路径，始终跳过。
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  VisualFramesSettings,
  VisualFramesStatus,
} from '../../../../shared/library/ipc'
import { mediaImageUrl, parseMediaUrl } from '../../../../shared/media-url'
import { isRemotePath } from '../../../../shared/webdav/remote-path'
import { originalPath } from '../../../thumbnails/paths'
import type { LibraryDb } from '../../db/database'
import { probeFileDuration } from '../../identify/media-duration'
import type { FollowupSpec } from '../../jobs/followups'
import type { JobContext, JobQueue } from '../../jobs/queue'
import { PermanentJobError } from '../../jobs/queue'
import { SettingsStore } from '../../providers/settings-store'
import type { VisualBackend } from '../clip-backend'
import { quantize } from '../visual-rules'
import {
  FfmpegMissingError,
  ffmpegDuration,
  extractFrame as ffmpegExtract,
} from './frame-ffmpeg'
import {
  dedupeFrames,
  frameSignature,
  frameThumbKey,
  parseFrameSettings,
  planFrames,
} from './frame-rules'
import { type FrameFile, type FrameRow, FrameStore } from './frame-store'

/** 任务类型。 */
export const FRAMES_JOB = 'visual-frames'
/** 排在所有后台活之后（识别后补图片索引是 -20）。 */
const FRAMES_PRIORITY = -30
/** 一次送进模型的帧数，也是进度落库的粒度。 */
const BATCH = 8
/** 让出后多久再排。 */
const IDLE_RETRY_MS = 60_000
/** 设置键。 */
const SETTINGS_KEY = 'visual.frames'

/** 取一帧（frame-ffmpeg.extractFrame 的形状，测试注入）。 */
export type ExtractFrame = (
  bin: string,
  input: string,
  atSec: number,
  thumbPath: string,
  signal: AbortSignal
) => Promise<Uint8Array | null>

/** 宿主 / 测试可注入的项（VisualOptions.frames）。 */
export interface FrameHostOptions {
  /** ffmpeg 路径；没有为空串。缺省按没有处理。 */
  ffmpegPath?: () => Promise<string>
  extract?: ExtractFrame
  /** 文件时长（秒）；缺省读文件头，读不到再问 ffmpeg。 */
  duration?: (bin: string, path: string) => Promise<number | null>
  /** 让出后多久再排，测试缩短。 */
  idleRetryMs?: number
}

/** 构造参数。 */
export interface FrameIndexerOptions extends FrameHostOptions {
  db: LibraryDb
  queue: JobQueue
  backend: VisualBackend
  /** 图片缓存根目录；没有时功能不可用。 */
  mediaDir?: string
  isCloudLibrary: (libraryId: number) => Promise<boolean>
  /** 一批帧入库后（搜索要重读向量）。 */
  onChanged: () => void
  log?: (message: string) => void
}

const defaultDuration = async (
  bin: string,
  path: string
): Promise<number | null> =>
  (await probeFileDuration(path)) ?? (await ffmpegDuration(bin, path))

export class FrameIndexer {
  private readonly store: FrameStore
  private readonly settingsStore: SettingsStore
  private running: { jobId: number; progress: number } | null = null
  private lastError: string | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: FrameIndexerOptions) {
    this.store = new FrameStore(options.db)
    this.settingsStore = new SettingsStore(options.db)
    options.queue.register(FRAMES_JOB, (_p, ctx) => this.run(ctx))
  }

  settings(): VisualFramesSettings {
    return parseFrameSettings(this.settingsStore.get(SETTINGS_KEY))
  }

  /** 改设置：打开 / 继续时排任务，关掉 / 暂停时取消正在跑的（进度保留）。 */
  setSettings(patch: Partial<VisualFramesSettings>): void {
    const next = { ...this.settings(), ...patch }
    this.settingsStore.set(SETTINGS_KEY, JSON.stringify(next), Date.now())
    if (!next.enabled || next.paused) {
      clearTimeout(this.retryTimer)
      if (this.running) this.options.queue.cancel(this.running.jobId)
    } else this.schedule()
  }

  /** 打开且没暂停时的抽帧任务（作为后继派发）；否则为空。 */
  followups(): FollowupSpec[] {
    const s = this.settings()
    if (!s.enabled || s.paused || !this.options.mediaDir) return []
    return [
      {
        type: FRAMES_JOB,
        key: FRAMES_JOB,
        payload: {},
        priority: FRAMES_PRIORITY,
        maxAttempts: 1,
      },
    ]
  }

  /** 排一个抽帧任务（同 key 已排队则合并）。 */
  schedule(): void {
    this.options.queue.dispatch(this.followups())
  }

  async status(model: string): Promise<VisualFramesStatus> {
    const files = await this.eligible()
    const indexed = files.filter(
      f => !needsWork(f, frameSignature(model, f.size, f.mtime))
    ).length
    return {
      ...this.settings(),
      running: this.running !== null,
      progress: this.running?.progress ?? null,
      indexed,
      total: files.length,
      frames: this.store.frameCount(),
      error: this.lastError,
    }
  }

  // —————————————————————————— 任务 ——————————————————————————

  private async run(ctx: JobContext): Promise<{ files: number }> {
    const { backend, mediaDir } = this.options
    const s = this.settings()
    if (!s.enabled || s.paused || !mediaDir) return { files: 0 }
    if (!(await backend.modelReady())) return { files: 0 }
    this.running = { jobId: ctx.job.id, progress: 0 }
    this.lastError = null
    try {
      const bin = (await this.options.ffmpegPath?.()) ?? ''
      if (!bin) throw new PermanentJobError('没有找到 ffmpeg，装上后再打开')
      const model = backend.model
      const todo = (await this.eligible()).filter(f =>
        needsWork(f, frameSignature(model, f.size, f.mtime))
      )
      let done = 0
      for (const [i, file] of todo.entries()) {
        const outcome = await this.indexFile(file, bin, model, mediaDir, ctx)
        if (outcome === 'yield') {
          this.retryLater()
          break
        }
        done++
        this.running.progress = (i + 1) / todo.length
        ctx.progress(this.running.progress)
      }
      return { files: done }
    } catch (error) {
      if (!ctx.signal.aborted) {
        this.lastError =
          error instanceof FfmpegMissingError
            ? '没有找到 ffmpeg，装上后再打开'
            : (error as Error).message
      }
      if (error instanceof FfmpegMissingError)
        throw new PermanentJobError(this.lastError!)
      throw error
    } finally {
      this.running = null
    }
  }

  /** 当前设置下可抽帧的文件：去掉远程源，网盘上的库按设置。 */
  private async eligible(): Promise<FrameFile[]> {
    const { includeCloud } = this.settings()
    const files = this.store.files('jav')
    const cloud = new Map<number, boolean>()
    for (const id of new Set(files.map(f => f.libraryId)))
      cloud.set(id, await this.options.isCloudLibrary(id))
    return files.filter(
      f => !isRemotePath(f.path) && (includeCloud || !cloud.get(f.libraryId))
    )
  }

  /** 抽一个文件（从断点接着抽）；队列里来了别的活时在批次之间让出。 */
  private async indexFile(
    file: FrameFile,
    bin: string,
    model: string,
    mediaDir: string,
    ctx: JobContext
  ): Promise<'done' | 'yield'> {
    const { signal } = ctx
    const signature = frameSignature(model, file.size, file.mtime)
    const resume =
      file.stored?.signature === signature &&
      file.stored.itemId === file.itemId &&
      file.stored.state === 'running'
    const duration =
      file.duration ??
      (await (this.options.duration ?? defaultDuration)(bin, file.path))
    const times = planFrames(duration)
    let start = 0
    let previous: Float32Array | null = null
    if (resume && file.stored) {
      start = file.stored.nextIndex
      previous = this.store.lastKept(file.fileId)
    } else {
      const old = this.store.begin(file, model, signature, times.length)
      await this.removeThumbs(old, mediaDir)
      this.options.onChanged()
    }
    if (!times.length) {
      this.store.fail(file.fileId, '读不到视频时长')
      return 'done'
    }
    for (let i = start; i < times.length; i += BATCH) {
      signal.throwIfAborted()
      if (this.store.othersBusy(FRAMES_JOB)) return 'yield'
      const batch = times.slice(i, i + BATCH)
      previous = await this.indexBatch(
        file,
        { bin, signature, mediaDir, previous, batch },
        { next: i + batch.length, total: times.length },
        signal
      )
      this.options.onChanged()
    }
    return 'done'
  }

  /** 抽一批、编码、去重、入库，返回最后保留的那帧向量。 */
  private async indexBatch(
    file: FrameFile,
    run: {
      bin: string
      signature: string
      mediaDir: string
      previous: Float32Array | null
      batch: number[]
    },
    position: { next: number; total: number },
    signal: AbortSignal
  ): Promise<Float32Array | null> {
    const extract = this.options.extract ?? ffmpegExtract
    const got: Array<{
      atMs: number
      key: string
      temp: string
      px: Uint8Array
    }> = []
    try {
      for (const atMs of run.batch) {
        const key = frameThumbKey(file.fileId, run.signature, atMs)
        const temp = `${originalPath(run.mediaDir, key)}.partial.jpg`
        await mkdir(dirname(temp), { recursive: true })
        const px = await extract(run.bin, file.path, atMs / 1000, temp, signal)
        if (px) got.push({ atMs, key, temp, px })
        else await rm(temp, { force: true })
      }
      const embeds = got.length
        ? await this.options.backend.embedImages(got.map(g => g.px))
        : []
      const kept = dedupeFrames(embeds, run.previous)
      const rows: FrameRow[] = []
      for (const k of kept) {
        const g = got[k]!
        await rename(g.temp, originalPath(run.mediaDir, g.key))
        rows.push({
          image: mediaImageUrl(g.key),
          atMs: g.atMs,
          vec: quantize(embeds[k]!),
        })
      }
      this.store.saveBatch(
        file,
        rows,
        position.next,
        position.next >= position.total
      )
      return kept.length ? embeds[kept.at(-1)!]! : run.previous
    } finally {
      // 丢掉的帧和取消时没来得及入库的缩略图
      await Promise.all(got.map(g => rm(g.temp, { force: true })))
    }
  }

  /** 让出：过一会儿再排（定时器不挡进程退出）。 */
  private retryLater(): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      try {
        this.schedule()
      } catch {
        // 引擎已关闭（数据库关了）：下次启动时会再排
      }
    }, this.options.idleRetryMs ?? IDLE_RETRY_MS)
    this.retryTimer.unref?.()
  }

  private async removeThumbs(
    images: readonly string[],
    mediaDir: string
  ): Promise<void> {
    for (const image of images) {
      const target = parseMediaUrl(image)
      if (target?.kind === 'image')
        await rm(originalPath(mediaDir, target.key), { force: true })
    }
  }
}

/** 文件要不要（继续）抽：没抽过、签名变了、换了条目、上次没抽完。 */
function needsWork(file: FrameFile, signature: string): boolean {
  const s = file.stored
  return (
    !s ||
    s.signature !== signature ||
    s.itemId !== file.itemId ||
    s.state === 'running'
  )
}
