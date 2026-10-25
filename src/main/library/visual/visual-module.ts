/**
 * 按画面搜模块：给番号条目的封面和剧照建 CLIP 向量索引，用一句话按画面内容找片。
 *
 * 链路：用户在搜索面板点「建立索引」→ visual-index 任务（缺模型先下载）→ 逐部取图（原图缓存，没下载的顺便下载）
 * → 编解码线程拉成 224×224 → 批量编码 → 按向量缩放量化成 int8 入库（每张约 0.5 KB）。之后识别出的新片由识别后继自动补索引（用户启用过才排）。
 * 搜索：文字编码一次，和内存里的全部向量做点积（10 万张图约几十毫秒），每部取最像的那张图排序。
 * 视频关键帧（frames/）：打开后后台从本地视频抽帧入同一张向量表，搜索结果带时间点（合并规则见 visual-rank.ts）。
 *
 * LibraryService 只做转发。
 */
import { readFile } from 'node:fs/promises'
import {
  type JobAccepted,
  LibraryError,
  type VisualFramesSettings,
  type VisualHit,
  type VisualSearchRequest,
  type VisualStatus,
} from '../../../shared/library/ipc'
import type { LibraryDb } from '../db/database'
import type { FollowupSpec } from '../jobs/followups'
import {
  type JobContext,
  type JobQueue,
  PermanentJobError,
} from '../jobs/queue'
import type { VisualBackend } from './clip-backend'
import { type FrameHostOptions, FrameIndexer } from './frames/frame-indexer'
import { type ScoredRow, rankHits } from './visual-rank'
import { type QuantizedVector, quantize, similarity } from './visual-rules'
import {
  type VisualCandidate,
  type VisualMatrix,
  VisualStore,
} from './visual-store'

/** 任务类型。 */
export const VISUAL_JOB = 'visual-index'
/** 自动补索引排在所有后台活之后。 */
const AUTO_PRIORITY = -20
/** 一次送进模型的图片数。 */
const BATCH = 8
/** 下载模型占整个任务进度的比例。 */
const DOWNLOAD_SHARE = 0.2

/** 模块参数。 */
export interface VisualModuleOptions {
  db: LibraryDb
  queue: JobQueue
  backend: VisualBackend
  /** 图片地址 → 本地原图路径（原图缓存，没下载的会下载）；没有缓存时为 null。 */
  imageFile: (url: string, signal?: AbortSignal) => Promise<string | null>
  /** 原图字节 → 224×224 RGBA（编解码线程）；解不了抛错。 */
  pixels: (bytes: Uint8Array) => Promise<Uint8Array>
  /** 图片缓存根目录（帧缩略图放在 orig/ 下）；没有时不抽帧。 */
  mediaDir?: string
  /** 库是否按网盘处理（抽帧默认跳过）。 */
  isCloudLibrary?: (libraryId: number) => Promise<boolean>
  /** 视频关键帧的宿主注入项（ffmpeg 路径等）。 */
  frames?: FrameHostOptions
  log?: (message: string) => void
}

export class VisualModule {
  private readonly store: VisualStore
  private readonly frames: FrameIndexer
  private matrix: VisualMatrix | null = null
  private running: { downloading: boolean; progress: number } | null = null
  private lastError: string | null = null

  constructor(private readonly options: VisualModuleOptions) {
    this.store = new VisualStore(options.db)
    options.queue.register(VISUAL_JOB, (_p, ctx) => this.run(ctx), {
      // 新片的图片索引好了，接着抽它们的视频帧（打开了才排）
      followups: { next: () => this.frames.followups() },
    })
    this.frames = new FrameIndexer({
      ...options.frames,
      db: options.db,
      queue: options.queue,
      backend: options.backend,
      mediaDir: options.mediaDir,
      isCloudLibrary: options.isCloudLibrary ?? (async () => false),
      onChanged: () => (this.matrix = null),
      log: options.log,
    })
    // 上次没抽完的帧接着抽（打开了才排；队列开始调度后才会跑）
    this.frames.schedule()
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  async status(): Promise<VisualStatus> {
    const { backend } = this.options
    const counts = this.store.counts('jav', backend.model)
    const ready = await backend.modelReady()
    return {
      runtime: await backend.available(),
      model: this.running?.downloading
        ? 'downloading'
        : ready
          ? 'ready'
          : 'missing',
      indexing: this.running !== null,
      progress: this.running?.progress ?? null,
      ...counts,
      error: this.lastError,
      frames: await this.frames.status(backend.model),
    }
  }

  /** 改视频关键帧设置。 */
  async setFrames(patch: Partial<VisualFramesSettings>): Promise<VisualStatus> {
    this.frames.setSettings(patch)
    return this.status()
  }

  /** 排一个索引任务（缺模型先下载）。 */
  index(): JobAccepted {
    const job = this.options.queue.enqueue({
      type: VISUAL_JOB,
      key: VISUAL_JOB,
      payload: {},
      priority: 1,
      maxAttempts: 1,
    })
    return { jobId: job.id }
  }

  async search(request: VisualSearchRequest): Promise<VisualHit[]> {
    const { backend } = this.options
    if (!(await backend.modelReady()))
      throw new LibraryError('conflict', '还没有下载按画面搜的模型')
    const query = await backend.embedText(request.text)
    const matrix = (this.matrix ??= this.store.matrix(backend.model))
    const allowed = this.store.scope('jav', request.libraryId)
    const rows: ScoredRow[] = []
    for (let row = 0; row < matrix.itemIds.length; row++) {
      const itemId = matrix.itemIds[row]!
      if (!allowed.has(itemId)) continue
      const fileId = matrix.fileIds[row]!
      rows.push({
        itemId,
        score: similarity(matrix.vectors, row, matrix.scales[row]!, query),
        image: matrix.images[row]!,
        ...(fileId ? { frame: { fileId, atMs: matrix.atMs[row]! } } : {}),
      })
    }
    const top = rankHits(rows, request.limit ?? 60)
    const titles = this.store.titlesOf(top.map(hit => hit.itemId))
    return top.map(hit => ({ ...hit, title: titles.get(hit.itemId) ?? '' }))
  }

  /** 识别后的后继：用户启用过（有索引）且模型在，就排一个低优先级的补索引任务。 */
  identifiedFollowups(itemIds: number[]): FollowupSpec[] {
    if (!itemIds.length || !this.store.any()) return []
    return [
      {
        type: VISUAL_JOB,
        key: VISUAL_JOB,
        payload: {},
        priority: AUTO_PRIORITY,
        maxAttempts: 1,
      },
    ]
  }

  // —————————————————————————— 任务 ——————————————————————————

  private async run(ctx: JobContext): Promise<{ indexed: number }> {
    const { backend } = this.options
    this.running = { downloading: false, progress: 0 }
    this.lastError = null
    try {
      if (!(await backend.available()))
        throw new PermanentJobError('当前系统缺少推理组件，按画面搜不可用')
      if (!(await backend.modelReady())) {
        this.running.downloading = true
        await backend.download(f => {
          this.running!.progress = f
          ctx.progress(f * DOWNLOAD_SHARE)
        }, ctx.signal)
        this.running.downloading = false
      }
      const list = this.store.candidates('jav', backend.model)
      let indexed = 0
      for (const [i, item] of list.entries()) {
        ctx.signal.throwIfAborted()
        if (await this.indexItem(item, ctx.signal)) indexed++
        const f = (i + 1) / list.length
        this.running.progress = f
        ctx.progress(DOWNLOAD_SHARE + f * (1 - DOWNLOAD_SHARE))
      }
      return { indexed }
    } catch (error) {
      if (!ctx.signal.aborted) this.lastError = (error as Error).message
      throw error
    } finally {
      this.running = null
    }
  }

  /** 给一部片建索引；一张图都取不到时不记录（下次再试），返回是否写入。 */
  private async indexItem(
    item: VisualCandidate,
    signal: AbortSignal
  ): Promise<boolean> {
    const { backend, imageFile, pixels } = this.options
    const loaded = await Promise.all(
      item.images.map(async image => {
        try {
          const file = await imageFile(image, signal)
          if (!file) return null
          return {
            image,
            rgba: await pixels(new Uint8Array(await readFile(file))),
          }
        } catch {
          signal.throwIfAborted()
          return null
        }
      })
    )
    const ok = loaded.filter(
      (x): x is { image: string; rgba: Uint8Array } => x !== null
    )
    if (!ok.length) return false
    const vectors: Array<{ image: string; vec: QuantizedVector }> = []
    for (let i = 0; i < ok.length; i += BATCH) {
      signal.throwIfAborted()
      const batch = ok.slice(i, i + BATCH)
      const embeds = await backend.embedImages(batch.map(b => b.rgba))
      embeds.forEach((vec, j) =>
        vectors.push({ image: batch[j]!.image, vec: quantize(vec) })
      )
    }
    this.store.save(item.itemId, backend.model, item.signature, vectors)
    this.matrix = null
    return true
  }
}
