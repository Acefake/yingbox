/**
 * 识别与刮削模块：把元数据源、HTTP 层、图片缓存、识别执行器组装起来，
 * 注册 identify 任务，实现识别相关的 IPC 方法。LibraryService 只做转发。
 *
 * 纯规则在 identify-rules，任务执行在 identify-job。
 */
import {
  type ApplyMatchRequest,
  type ApplyMatchResult,
  type IdentifyRequest,
  type JavSettings,
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
import { ItemChanges } from '../catalog/catalog-store'
import type { CatalogQuery } from '../catalog/query'
import { type LibraryDb, transaction } from '../db/database'
import { type BinaryFetch, ImageCache } from '../images/image-cache'
import type { FollowupSpec } from '../jobs/followups'
import type { JobQueue } from '../jobs/queue'
import { SqliteResponseCache } from '../providers/http/provider-cache'
import { type FetchLike, ProviderHttp } from '../providers/http/provider-http'
import type { ActorSource } from '../providers/jav/actors'
import {
  type JavProvider,
  createJavProvider,
} from '../providers/jav/jav-provider'
import { JavSettingsStore } from '../providers/jav/jav-settings'
import type { JavCredentials } from '../providers/jav/sites/registry'
import type { LibraryEnvSecrets } from '../platform/platform'
import type { Clock } from '../providers/http/rate-limiter'
import { OpenSubtitlesHashLookup } from '../providers/opensubtitles/os-hash-lookup'
import { SETTING_KEYS, SettingsStore } from '../providers/settings-store'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import { type IdentifyResult, runIdentifyJob } from './identify-job'
import { TOKEN_SETTING_KEYS, readJavCredentials } from './provider-credentials'
import {
  type IdentifyPayload,
  candidateInfo,
  identifyJobSpec,
  itemsChangedEvents,
  mergeIdentifyPayload,
  scoredInfo,
  toLibraryError,
} from './identify-rules'
import { IdentifyRunner } from './identify-runner'
import { IdentifyStore, type IdentifyTarget } from './identify-store'
import { probeFileDuration } from './media-duration'
import { MetadataWriter } from './metadata-writer'

export { type IdentifyPayload, mergeIdentifyPayload } from './identify-rules'

/** 文本与二进制都能取的 fetch（标准 fetch / Electron net.fetch 都满足）。 */
export type HttpFetch = (
  url: string,
  init: {
    headers?: Record<string, string>
    signal?: AbortSignal
    /** 缺省 GET；番号站点的检索表单 / JSON 接口用 POST。 */
    method?: 'GET' | 'POST'
    body?: string
    redirect?: 'follow' | 'manual'
  }
) => ReturnType<FetchLike> & ReturnType<BinaryFetch>

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
  env?: LibraryEnvSecrets
  /** TMDB 限速参数与时钟（测试、基准注入）。 */
  http?: { rps?: number; concurrency?: number; clock?: Clock }
  /** 同时识别的条目数，默认 8。 */
  concurrency?: number
  /** 给番号站点没带头像的演员补头像的来源（演员库共用的 gfriends）；缺省 JavProvider 自建。 */
  avatars?: ActorSource
  /** 识别 / 刷新 / 手动匹配后，元数据有变化的顶层条目（可能为空，此时应给出空列表）要派的后继。 */
  followups?: (itemIds: number[]) => readonly FollowupSpec[]
  log?: (message: string) => void
}

/** 任务优先级：用户点的识别 > 扫描后自动识别。 */
const PRIORITY = { user: 15, auto: 3 } as const

/** 识别与刮削模块。 */
export class IdentifyModule {
  readonly provider: TmdbProvider
  /** 番号库的元数据源（番号站点聚合）。 */
  readonly jav: JavProvider
  readonly http: ProviderHttp
  readonly store: IdentifyStore
  readonly runner: IdentifyRunner
  /** 原图缓存；没有缓存目录时为 undefined。写出层复用它拿图片。 */
  readonly images: ImageCache | undefined
  private readonly cache: SqliteResponseCache
  private readonly settings: SettingsStore
  private readonly hashLookup: OpenSubtitlesHashLookup
  private readonly javSettings: JavSettingsStore
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
    this.javSettings = new JavSettingsStore(this.settings)
    this.jav = createJavProvider({
      fetch: fetchImpl,
      clock: options.http?.clock,
      cache: this.cache,
      settings: () => this.javSettings.get(),
      credentials: () => this.javCredentials(),
      avatars: options.avatars,
      log: this.log,
    })
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
      jav: this.jav,
      hashLookup: this.hashLookup,
      images: this.images,
      probeDuration: options.probeDuration ?? probeFileDuration,
      fingerprint: options.fingerprint,
      log: this.log,
    })
    options.queue.register(
      'identify',
      (p, ctx) =>
        runIdentifyJob(
          {
            store: this.store,
            cache: this.cache,
            runner: this.runner,
            emit: options.emit,
            emitChanges: changes => this.emitChanges(changes),
            concurrency: options.concurrency,
          },
          p as IdentifyPayload,
          ctx
        ),
      {
        merge: mergeIdentifyPayload,
        followups: {
          next: ({ result }) =>
            options.followups?.((result as IdentifyResult).changed) ?? [],
        },
      }
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

  /** 扫描后自动识别新增 / 变化条目的后继（TMDB 库没有令牌时没有；番号库不需要令牌）。 */
  autoFollowup(libraryId: number): FollowupSpec | null {
    if (!this.configured && this.store.needsTmdb({ libraryId })) return null
    return identifyJobSpec({ mode: 'identify', libraryId }, PRIORITY.auto)
  }

  private enqueue(payload: IdentifyPayload, priority: number): JobAccepted {
    const job = this.options.queue.enqueue(identifyJobSpec(payload, priority))
    return { jobId: job.id }
  }

  /** 涉及 TMDB 库时要求已配置令牌。 */
  private requireToken(
    scope: { libraryId?: number; itemIds?: number[] } = {}
  ): void {
    if (!this.configured && this.store.needsTmdb(scope)) {
      throw new LibraryError('invalid-params', '未配置 TMDB API 令牌')
    }
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  /** 识别条目（排队）。 */
  identify(request: IdentifyRequest): JobAccepted {
    this.requireToken(request)
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
    this.requireToken(request)
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
    const target = this.requireTarget(request.itemId)
    if (target.source !== 'jav') this.requireToken({ itemIds: [target.id] })
    try {
      const result = await this.runner.applyManual(target, request)
      this.emitChanges(result.changes)
      if (result.status === 'matched')
        this.options.queue.dispatch(this.options.followups?.([target.id]) ?? [])
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

  /** 设置 / 清除令牌。番号站点凭据变了，清掉该站缓存的「查无此片」等结果。 */
  setProviderToken(request: SetProviderTokenRequest): ProviderStatus {
    this.settings.set(
      TOKEN_SETTING_KEYS[request.provider],
      request.token,
      Date.now()
    )
    if (request.provider === 'theporndb' || request.provider === 'javdb')
      this.cache.expire(
        [`jav:${request.provider}:`, `actor:${request.provider}:`],
        Date.now()
      )
    return this.getProviderStatus()
  }

  /** 令牌配置状态。 */
  getProviderStatus(): ProviderStatus {
    const jav = this.javCredentials()
    return {
      tmdb: { configured: this.provider.configured },
      opensubtitles: { configured: this.hashLookup.configured },
      theporndb: { configured: Boolean(jav.theporndbToken) },
      javdb: { configured: Boolean(jav.javdbCookie) },
      dmm_api: { configured: Boolean(jav.dmmApi) },
    }
  }

  /** 番号站点凭据：设置里的优先，没有用环境变量（演员库的 ThePornDB 来源也用它）。 */
  javCredentials(): JavCredentials {
    return readJavCredentials(this.settings, this.options.env)
  }

  /** 番号站点设置。 */
  getJavSettings(): JavSettings {
    return this.javSettings.get()
  }

  /** 保存番号站点设置（参数已在 IPC 边界校验）。 */
  setJavSettings(value: JavSettings): JavSettings {
    return this.javSettings.set(value, Date.now())
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
    for (const event of itemsChangedEvents(changes, libraryOf)) {
      this.options.emit(event)
    }
  }
}
