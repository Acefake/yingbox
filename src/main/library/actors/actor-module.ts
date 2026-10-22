/**
 * 演员库模块：把演员仓库、资料来源、来源设置、actor-profile 任务组装起来，实现演员相关的 IPC 方法。
 * LibraryService 只做转发。
 *
 * 链路：识别 / 刷新 / 手动匹配完成（识别的后继 identifiedFollowups）→ 按条目演员表同步 item_actors（新名字建演员行）→
 * 设置允许时派一个低优先级 auto 任务，为待查的演员查资料（见 actor-job）。影片入库不等它。
 */
import { join } from 'node:path'
import {
  type ActorDetail,
  type ActorListResult,
  type ActorSettings,
  type ActorSummary,
  ITEMS_CHANGED_LIMIT,
  LibraryError,
  type LibraryEvent,
  type NormalizedActorQuery,
  type RefreshActorsRequest,
  type UpdateActorRequest,
} from '../../../shared/library/ipc'
import { type LibraryDb, transaction } from '../db/database'
import type { IdentifyModule } from '../identify/identify-module'
import type { FollowupSpec } from '../jobs/followups'
import type { JobContext, JobQueue } from '../jobs/queue'
import { SqliteResponseCache } from '../providers/http/provider-cache'
import { type ActorSource, createActorSources } from '../providers/jav/actors'
import { SettingsStore } from '../providers/settings-store'
import {
  type ActorJobPayload,
  actorJobKey,
  mergeActorPayload,
  runActorJob,
} from './actor-job'
import { applyEdit } from './actor-rules'
import { ActorSettingsStore } from './actor-settings'
import { ActorStore, type NfoActorLookup } from './actor-store'
import { createFileGfriendsStore } from './gfriends-file-store'

/** 任务类型。 */
export const ACTOR_JOB = 'actor-profile'
/** 任务优先级：手动刷新略高于扫描后的自动识别以下的后台活，自动查资料排在所有任务之后。 */
const PRIORITY = { refresh: 2, auto: -10 } as const
/** 一次性回填（升级前已入库的番号条目）的标记键。 */
const BACKFILL_KEY = 'actors.backfilled'

/** 模块参数。 */
export interface ActorModuleOptions {
  db: LibraryDb
  queue: JobQueue
  emit: (event: LibraryEvent) => void
  /** 图片缓存根目录；gfriends 索引存在它的上一级（片库数据目录）。缺省不持久化索引。 */
  mediaDir?: string
  /**
   * 识别模块提供的能力：番号元数据源 jav（取页上下文、熔断与限速共用）、原图缓存 images（头像落本地）、
   * 番号站点凭据 javCredentials（ThePornDB 令牌与影片站点共用）。识别模块后建，所以是函数。
   */
  identify: () => Pick<IdentifyModule, 'jav' | 'images' | 'javCredentials'>
  /** 资料来源，测试注入；缺省为全部内置来源。 */
  sources?: readonly ActorSource[]
  /** 同时查的演员数，默认 3。 */
  concurrency?: number
  log?: (message: string) => void
}

/** 演员库模块。 */
export class ActorModule {
  readonly store: ActorStore
  /** 给番号站点没带头像的演员补头像（gfriends，遵守来源开关）。 */
  readonly avatars: ActorSource | undefined
  private readonly sources: readonly ActorSource[]
  private readonly settings: ActorSettingsStore
  private readonly kv: SettingsStore
  private readonly cache: SqliteResponseCache

  constructor(private readonly options: ActorModuleOptions) {
    const { db } = options
    this.store = new ActorStore(db)
    this.kv = new SettingsStore(db)
    this.settings = new ActorSettingsStore(this.kv)
    this.cache = new SqliteResponseCache(db)
    this.sources =
      options.sources ??
      createActorSources({
        gfriends: options.mediaDir
          ? {
              store: createFileGfriendsStore(
                join(options.mediaDir, '..', 'gfriends-index.json')
              ),
            }
          : {},
        theporndbToken: () =>
          options.identify().javCredentials().theporndbToken,
      })
    const gfriends = this.sources.find(s => s.id === 'gfriends')
    this.avatars = gfriends
      ? {
          ...gfriends,
          fetch: (name, ctx) =>
            this.enabled('gfriends')
              ? gfriends.fetch(name, ctx)
              : Promise.resolve(null),
        }
      : undefined
    options.queue.register(
      ACTOR_JOB,
      (p, ctx) => this.run(p as ActorJobPayload, ctx),
      { merge: mergeActorPayload }
    )
  }

  /** 启动：升级后第一次运行时，为已入库的番号条目回填演员关联；有待查的演员就排任务。 */
  start(): void {
    if (!this.kv.get(BACKFILL_KEY)) {
      this.sync(null)
      this.kv.set(BACKFILL_KEY, '1', Date.now())
    }
    this.options.queue.dispatch(this.autoFollowups())
  }

  /** 识别后的后继：先同步这些条目的演员关联并推送变化，再按设置给出自动查资料任务。 */
  identifiedFollowups(itemIds: number[]): FollowupSpec[] {
    if (!itemIds.length) return []
    this.sync(itemIds)
    return this.autoFollowups()
  }

  /** 条目演员的 NFO 资料（写出层用）。 */
  nfoProfiles(itemId: number): NfoActorLookup {
    return this.store.nfoProfiles(itemId)
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  list(query: NormalizedActorQuery): ActorListResult {
    return this.store.list(query)
  }

  get(actorId: number): ActorDetail | null {
    const rec = this.store.record(actorId)
    return rec ? { ...rec, workCount: this.store.workCount(actorId) } : null
  }

  forItem(itemId: number): ActorSummary[] {
    return this.store.forItem(itemId)
  }

  /** 手动编辑并设置锁定字段；改了头像时重新缓存首选头像。 */
  async update(request: UpdateActorRequest): Promise<ActorDetail> {
    const rec = this.requireActor(request.actorId)
    const edit = applyEdit(rec, request.values)
    let photo = rec.photo
    if (request.values.images) {
      const url = edit.values.images[0]
      photo = url
        ? ((await this.options.identify().images?.ensure([url]))?.get(url) ??
          url)
        : null
    }
    transaction(this.options.db, () =>
      this.store.writeProfile(rec.id, rec.name, edit, {
        photo,
        lockedFields: request.lockedFields,
        now: Date.now(),
      })
    )
    this.emitActors([rec.id])
    return this.get(rec.id)!
  }

  /** 手动刷新（忽略缓存）。 */
  refresh(request: RefreshActorsRequest): { jobId: number } {
    for (const id of request.actorIds ?? []) this.requireActor(id)
    const payload: ActorJobPayload = { mode: 'refresh', ...request }
    const job = this.options.queue.enqueue({
      type: ACTOR_JOB,
      key: actorJobKey('refresh'),
      payload,
      priority: PRIORITY.refresh,
    })
    return { jobId: job.id }
  }

  /** 取消排队中 / 运行中的演员资料任务，返回取消了几个。 */
  cancelRefresh(): { cancelled: number } {
    const ids = this.options.db
      .prepare(
        `SELECT id FROM jobs WHERE type = ? AND state IN ('queued', 'running')`
      )
      .all(ACTOR_JOB)
      .map(r => Number(r.id))
    return {
      cancelled: ids.filter(id => this.options.queue.cancel(id)).length,
    }
  }

  getSettings(): ActorSettings {
    return this.settings.get()
  }

  /** 保存来源设置；打开自动查资料时立即补查待查的演员。 */
  setSettings(value: ActorSettings): ActorSettings {
    const saved = this.settings.set(value, Date.now())
    this.options.queue.dispatch(this.autoFollowups())
    return saved
  }

  // —————————————————————————— 内部 ——————————————————————————

  private enabled(id: ActorSource['id']): boolean {
    return this.settings.get().sources.some(s => s.id === id && s.enabled)
  }

  private requireActor(
    id: number
  ): NonNullable<ReturnType<ActorStore['record']>> {
    const rec = this.store.record(id)
    if (!rec) throw new LibraryError('not-found', `演员 ${id} 不存在`)
    return rec
  }

  /** 同步条目 ↔ 演员关联（itemIds 为 null 时全部番号条目），推送涉及的演员。 */
  private sync(itemIds: number[] | null): void {
    const touched = new Set<number>()
    transaction(this.options.db, () => {
      const now = Date.now()
      for (const item of this.store.javItems(itemIds)) {
        for (const id of this.store.syncItem(item.id, item.metadata, now)
          .touched)
          touched.add(id)
      }
    })
    if (touched.size) this.emitActors([...touched])
  }

  /** 设置允许、且有待查的演员时的 auto 任务（同键合并，不会排出一串）。 */
  private autoFollowups(): FollowupSpec[] {
    if (!this.settings.get().autoLookup) return []
    if (!this.store.pendingIds(Date.now()).length) return []
    return [
      {
        type: ACTOR_JOB,
        key: actorJobKey('auto'),
        payload: { mode: 'auto' } satisfies ActorJobPayload,
        priority: PRIORITY.auto,
      },
    ]
  }

  private run(payload: ActorJobPayload, ctx: JobContext): Promise<void> {
    return runActorJob(
      {
        db: this.options.db,
        store: this.store,
        cache: this.cache,
        sources: () => this.sources,
        settings: () => this.settings.get(),
        context: signal => this.options.identify().jav.actorContext(signal),
        images: this.options.identify().images,
        emit: ids => this.emitActors(ids),
        concurrency: this.options.concurrency,
        log: this.options.log,
      },
      payload,
      ctx
    )
  }

  private emitActors(actorIds: number[]): void {
    const reset = actorIds.length > ITEMS_CHANGED_LIMIT
    this.options.emit({
      type: 'actors-changed',
      actorIds: reset ? [] : actorIds,
      reset,
    })
  }
}
