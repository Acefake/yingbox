/**
 * 识别与刮削模块：把元数据源、HTTP 层、图片缓存、识别执行器组装起来，
 * 注册 identify 任务，实现识别相关的 IPC 方法。LibraryService 只做转发。
 */
import {
  type ApplyMatchRequest,
  type ApplyMatchResult,
  type IdentifyProgressEvent,
  type IdentifyRequest,
  type JobAccepted,
  LibraryError,
  type LibraryEvent,
  type LibraryItemSummary,
  type MatchCandidateInfo,
  type MatchCandidatesResult,
  type ProviderStatus,
  type RefreshMetadataRequest,
  type SetProviderTokenRequest,
} from '../../../shared/library/ipc'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import { ItemChanges } from '../catalog/catalog-store'
import type { CatalogQuery } from '../catalog/query'
import { type LibraryDb, transaction } from '../db/database'
import { type BinaryFetch, ImageCache } from '../images/image-cache'
import {
  type JobContext,
  type JobQueue,
  PermanentJobError,
} from '../jobs/queue'
import { SqliteResponseCache } from '../providers/http/provider-cache'
import {
  type FetchLike,
  ProviderAuthError,
  ProviderHttp,
} from '../providers/http/provider-http'
import type { Clock } from '../providers/http/rate-limiter'
import { OpenSubtitlesHashLookup } from '../providers/opensubtitles/os-hash-lookup'
import { SETTING_KEYS, SettingsStore } from '../providers/settings-store'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import {
  IdentifyRunner,
  type RunMode,
  type RunSummary,
} from './identify-runner'
import {
  IdentifyStore,
  type IdentifyTarget,
  type StoredCandidate,
} from './identify-store'
import { probeFileDuration } from './media-duration'
import { MetadataWriter } from './metadata-writer'

/** 文本与二进制都能取的 fetch（标准 fetch / Electron net.fetch 都满足）。 */
export type HttpFetch = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal }
) => ReturnType<FetchLike> & ReturnType<BinaryFetch>

/** identify 任务载荷。 */
export interface IdentifyPayload {
  mode: RunMode
  libraryId?: number
  itemIds?: number[]
}

/** 模块参数。 */
export interface IdentifyModuleOptions {
  db: LibraryDb
  queue: JobQueue
  catalogQuery: CatalogQuery
  emit: (event: LibraryEvent) => void
  /** 网络请求实现；缺省用全局 fetch。 */
  fetch?: HttpFetch
  /** 图片缓存目录；缺省不缓存图片（只存远程地址）。 */
  mediaDir?: string
  /** 原图落盘后回调（主进程生成缩略图）。 */
  onImagesCached?: (keys: string[]) => void
  /** 视频时长探测，测试注入。 */
  probeDuration?: (path: string) => Promise<number | undefined>
  /** 文件指纹（OpenSubtitles hash）。 */
  fingerprint?: (path: string) => Promise<string | undefined>
  /** 环境变量兜底的令牌（设置里没有时使用）。 */
  env?: { tmdbToken?: string; opensubtitlesKey?: string }
  /** TMDB 限速参数与时钟（测试、基准注入）。 */
  http?: { rps?: number; concurrency?: number; clock?: Clock }
  /** 同时识别的条目数，默认 8。 */
  concurrency?: number
  /** 识别 / 刷新 / 手动匹配后有元数据变化的顶层条目（写出层据此自动写 NFO）。 */
  onIdentified?: (itemIds: number[]) => void
  log?: (message: string) => void
}

/** 任务优先级：用户点的识别 > 扫描后自动识别。 */
const PRIORITY = { user: 15, auto: 3 } as const
/** 进度事件最小间隔。 */
const PROGRESS_INTERVAL_MS = 250

/** 合并同 key 的排队识别：任一方是整库就是整库，否则条目取并集。 */
export function mergeIdentifyPayload(a: unknown, b: unknown): IdentifyPayload {
  const x = a as IdentifyPayload
  const y = b as IdentifyPayload
  if (!x.itemIds || !y.itemIds) {
    return { mode: x.mode, libraryId: x.libraryId ?? y.libraryId }
  }
  return {
    mode: x.mode,
    libraryId: x.libraryId,
    itemIds: [...new Set([...x.itemIds, ...y.itemIds])],
  }
}

/** 识别与刮削模块。 */
export class IdentifyModule {
  readonly provider: TmdbProvider
  readonly http: ProviderHttp
  readonly store: IdentifyStore
  readonly runner: IdentifyRunner
  /** 原图缓存；没有缓存目录时为 undefined。写出层复用它拿图片。 */
  readonly images: ImageCache | undefined
  private readonly cache: SqliteResponseCache
  private readonly settings: SettingsStore
  private readonly hashLookup: OpenSubtitlesHashLookup
  private readonly log: (message: string) => void

  constructor(private readonly options: IdentifyModuleOptions) {
    const { db } = options
    const fetchImpl =
      options.fetch ?? (globalThis.fetch as unknown as HttpFetch)
    this.log = options.log ?? (() => {})
    this.cache = new SqliteResponseCache(db)
    this.settings = new SettingsStore(db)
    this.http = new ProviderHttp({
      fetch: fetchImpl,
      cache: this.cache,
      rps: options.http?.rps ?? 20,
      concurrency: options.http?.concurrency ?? 8,
      clock: options.http?.clock,
    })
    this.provider = new TmdbProvider({
      http: this.http,
      token: () =>
        this.settings.get(SETTING_KEYS.tmdbToken) ?? options.env?.tmdbToken,
    })
    this.hashLookup = new OpenSubtitlesHashLookup(
      new ProviderHttp({
        fetch: fetchImpl,
        cache: this.cache,
        rps: 4,
        concurrency: 2,
      }),
      () =>
        this.settings.get(SETTING_KEYS.opensubtitlesKey) ??
        options.env?.opensubtitlesKey
    )
    this.store = new IdentifyStore(db)
    this.images = options.mediaDir
      ? new ImageCache({
          db,
          mediaDir: options.mediaDir,
          fetch: fetchImpl,
          onCached: options.onImagesCached,
        })
      : undefined
    this.runner = new IdentifyRunner({
      db,
      store: this.store,
      writer: new MetadataWriter(db),
      provider: this.provider,
      hashLookup: this.hashLookup,
      images: this.images,
      probeDuration: options.probeDuration ?? probeFileDuration,
      fingerprint: options.fingerprint,
      log: this.log,
    })
    options.queue.register(
      'identify',
      (p, ctx) => this.runJob(p as IdentifyPayload, ctx),
      { merge: mergeIdentifyPayload }
    )
  }

  /** 启动时清理过期太久的缓存。 */
  start(): void {
    const removed = this.cache.prune(Date.now())
    if (removed) this.log(`清理过期元数据缓存 ${removed} 条`)
  }

  /** 是否配置了 TMDB 令牌。 */
  get configured(): boolean {
    return this.provider.configured
  }

  /** 扫描后自动识别新增 / 变化的条目（没有令牌时不排）。 */
  enqueueAuto(libraryId: number): void {
    if (!this.configured) return
    this.enqueue({ mode: 'identify', libraryId }, PRIORITY.auto)
  }

  private enqueue(payload: IdentifyPayload, priority: number): JobAccepted {
    const scope = payload.itemIds ? 'items' : `library:${payload.libraryId}`
    const job = this.options.queue.enqueue({
      type: 'identify',
      key: `identify:${payload.mode}:${scope}`,
      payload,
      priority,
    })
    return { jobId: job.id }
  }

  private requireToken(): void {
    if (!this.configured) {
      throw new LibraryError('invalid-params', '未配置 TMDB API 令牌')
    }
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  /** 识别条目（排队）。 */
  identify(request: IdentifyRequest): JobAccepted {
    this.requireToken()
    return this.enqueue(
      {
        mode: request.force ? 'force' : 'identify',
        libraryId: request.libraryId,
        itemIds: request.itemIds,
      },
      PRIORITY.user
    )
  }

  /** 刷新元数据（排队）。 */
  refreshMetadata(request: RefreshMetadataRequest): JobAccepted {
    this.requireToken()
    return this.enqueue(
      {
        mode: 'refresh',
        libraryId: request.libraryId,
        itemIds: request.itemIds,
      },
      PRIORITY.user
    )
  }

  /** 条目当前匹配与保存的候选。 */
  getMatchCandidates(itemId: number): MatchCandidatesResult {
    const target = this.requireTarget(itemId)
    const rows = this.store.matches(itemId)
    const info = (r: (typeof rows)[number]): MatchCandidateInfo =>
      candidateInfo(r.ref.kind, r.ref.id, r.candidate, r.confidence)
    const current = rows.find(r => r.status === 'auto' || r.status === 'locked')
    return {
      itemId,
      matchState: target.matchState,
      current: current ? info(current) : null,
      candidates: rows.filter(r => r !== current).map(info),
    }
  }

  /** 手动匹配。 */
  async applyMatch(request: ApplyMatchRequest): Promise<ApplyMatchResult> {
    this.requireToken()
    const target = this.requireTarget(request.itemId)
    try {
      const result = await this.runner.applyManual(target, request)
      this.emitChanges(result.changes)
      if (result.status === 'matched') this.options.onIdentified?.([target.id])
      return {
        status: result.status,
        item: this.options.catalogQuery.summary(target.id),
        candidates: result.candidates.map(scoredInfo),
      }
    } catch (error) {
      throw toLibraryError(error)
    }
  }

  /** 锁定当前匹配：之后的自动识别不再改动。 */
  lockMatch(itemId: number): LibraryItemSummary {
    const target = this.requireTarget(itemId)
    if (!target.tmdbId) {
      throw new LibraryError('conflict', '条目还没有匹配，无法锁定')
    }
    return this.setState(itemId, 'locked')
  }

  /** 解除锁定（保留当前匹配，状态回到自动）。 */
  unlockMatch(itemId: number): LibraryItemSummary {
    const target = this.requireTarget(itemId)
    return this.setState(itemId, target.tmdbId ? 'auto' : 'unmatched')
  }

  /** 设置 / 清除令牌。 */
  setProviderToken(request: SetProviderTokenRequest): ProviderStatus {
    const key =
      request.provider === 'tmdb'
        ? SETTING_KEYS.tmdbToken
        : SETTING_KEYS.opensubtitlesKey
    this.settings.set(key, request.token, Date.now())
    return this.getProviderStatus()
  }

  /** 令牌配置状态。 */
  getProviderStatus(): ProviderStatus {
    return {
      tmdb: { configured: this.provider.configured },
      opensubtitles: { configured: this.hashLookup.configured },
    }
  }

  // —————————————————————————— 内部 ——————————————————————————

  private requireTarget(itemId: number): IdentifyTarget {
    const target = this.store.target(itemId)
    if (!target) {
      throw new LibraryError(
        'not-found',
        `条目 ${itemId} 不存在或不是电影 / 剧集`
      )
    }
    return target
  }

  private setState(
    itemId: number,
    state: 'locked' | 'auto' | 'unmatched'
  ): LibraryItemSummary {
    transaction(this.options.db, () =>
      this.store.setMatchState(itemId, state, Date.now())
    )
    const changes = new ItemChanges()
    changes.touch(itemId)
    this.emitChanges(changes)
    return this.options.catalogQuery.summary(itemId)!
  }

  /** 按媒体库拆分变化并推送 items-changed。 */
  private emitChanges(changes: ItemChanges): void {
    if (changes.empty) return
    const ids = [...changes.added, ...changes.updated]
    const libraryOf = new Map<number, number>()
    for (const row of this.options.db
      .prepare(
        'SELECT id, library_id FROM media_items WHERE id IN (SELECT value FROM json_each(?))'
      )
      .all(JSON.stringify(ids))) {
      libraryOf.set(Number(row.id), Number(row.library_id))
    }
    const byLibrary = new Map<number, ItemChanges>()
    const bucket = (id: number): ItemChanges | undefined => {
      const lib = libraryOf.get(id)
      if (lib === undefined) return undefined
      let c = byLibrary.get(lib)
      if (!c) byLibrary.set(lib, (c = new ItemChanges()))
      return c
    }
    for (const id of changes.added) bucket(id)?.added.add(id)
    for (const id of changes.updated) bucket(id)?.updated.add(id)
    for (const [libraryId, c] of byLibrary) {
      this.options.emit({
        type: 'items-changed',
        libraryId,
        added: [...c.added],
        updated: [...c.updated],
        removed: [],
        reset: false,
      })
    }
  }

  /** identify 任务。 */
  private async runJob(
    payload: IdentifyPayload,
    ctx: JobContext
  ): Promise<void> {
    const mode = payload.mode
    const targets = this.store.targets(
      mode === 'refresh' ? 'matched' : mode === 'force' ? 'force' : 'pending',
      { libraryId: payload.libraryId, itemIds: payload.itemIds }
    )
    if (mode === 'refresh') {
      // 让这些条目的缓存过期，走 ETag 条件请求拿最新数据
      this.cache.expire(
        targets.flatMap(t =>
          t.type === 'movie'
            ? [`tmdb:/movie/${t.tmdbId}?`]
            : [`tmdb:/tv/${t.tmdbId}?`, `tmdb:/tv/${t.tmdbId}/`]
        ),
        Date.now()
      )
    }
    let lastEmit = 0
    const progress = (
      summary: RunSummary,
      finished: boolean,
      error?: string
    ): void => {
      const event: IdentifyProgressEvent = {
        type: 'identify-progress',
        jobId: ctx.job.id,
        mode: mode === 'refresh' ? 'refresh' : 'identify',
        libraryId: payload.libraryId ?? null,
        total: summary.total,
        done: summary.done,
        matched: summary.matched,
        review: summary.review,
        unmatched: summary.unmatched,
        failed: summary.failed,
        finished,
        ...(error ? { error } : {}),
      }
      this.options.emit(event)
    }
    // 条目变化分段推送：海报墙边识别边刷新，每个 id 只推一次
    const emitted = new Set<number>()
    const flush = (all: ItemChanges): void => {
      const fresh = new ItemChanges()
      for (const id of all.added) if (!emitted.has(id)) fresh.added.add(id)
      for (const id of all.updated) if (!emitted.has(id)) fresh.updated.add(id)
      for (const id of [...fresh.added, ...fresh.updated]) emitted.add(id)
      this.emitChanges(fresh)
    }
    let summary: RunSummary | undefined
    try {
      summary = await this.runner.run(targets, mode, {
        signal: ctx.signal,
        concurrency: this.options.concurrency,
        onProgress: s => {
          summary = s
          ctx.progress(s.total ? s.done / s.total : 1)
          const now = Date.now()
          if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now
            progress(s, false)
            flush(s.changes)
          }
        },
      })
    } catch (error) {
      if (ctx.signal.aborted) throw error
      const message = (error as Error).message
      if (summary) {
        flush(summary.changes)
        progress(summary, true, message)
      }
      if (error instanceof ProviderAuthError)
        throw new PermanentJobError(message)
      throw error
    }
    flush(summary.changes)
    progress(summary, true)
    const changed = [...summary.changes.added, ...summary.changes.updated]
    if (changed.length) this.options.onIdentified?.(changed)
  }
}

/** 存储的候选 → IPC 候选。 */
function candidateInfo(
  kind: MatchCandidateInfo['kind'],
  id: string,
  c: StoredCandidate,
  confidence: number
): MatchCandidateInfo {
  return {
    provider: 'tmdb',
    kind,
    id,
    title: c.title,
    originalTitle: c.originalTitle ?? null,
    year: c.year ?? null,
    confidence,
    breakdown: c.breakdown ?? {},
    poster: c.posterPath ? TmdbProvider.imageUrl(c.posterPath, 'w185') : null,
  }
}

/** 打分候选 → IPC 候选。 */
function scoredInfo(s: ScoredCandidate): MatchCandidateInfo {
  const breakdown: Record<string, number> = {}
  for (const [k, v] of Object.entries(s.breakdown)) {
    if (typeof v === 'number') breakdown[k] = v
  }
  return candidateInfo(
    s.candidate.ref.kind,
    s.candidate.ref.id,
    {
      title: s.candidate.title,
      originalTitle: s.candidate.originalTitle,
      year: s.candidate.year,
      posterPath: s.candidate.posterPath,
      breakdown,
    },
    s.score
  )
}

/** 网络 / 令牌错误转成带错误码的 LibraryError。 */
function toLibraryError(error: unknown): unknown {
  if (error instanceof LibraryError) return error
  if (error instanceof ProviderAuthError) {
    return new LibraryError('invalid-params', error.message)
  }
  return error
}
