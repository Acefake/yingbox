/**
 * 识别与刮削的执行器：对一批顶层条目跑识别链，拉元数据入库，缓存海报 / 背景图。
 *
 * - 电影：见 runner-movie（按文件分组识别，不同影片拆成多个条目）；
 * - 剧集：见 runner-series（剧集文件夹层识别一次）；匹配后这里按 季 / 集
 *   （绝对集数按剧集分组顺序）写每季每集的元数据；
 * - 番号库：见 runner-jav（按文件名里的番号直接查番号站点）；
 * - 手动匹配：见 runner-manual；
 * - 锁定的条目永不被自动识别覆盖，只在刷新元数据时更新元数据本身。
 *
 * 条目之间并发执行，网络请求统一经 ProviderHttp 限速；数据库写入是同步的短事务。
 */
import type { IdentifyResult } from '../../../shared/library/identify'
import { LibraryError } from '../../../shared/library/ipc'
import type { ApplyMatchRequest } from '../../../shared/library/ipc'
import type {
  MediaMetadata,
  MediaRef,
  SeasonMetadata,
} from '../../../shared/library/provider'
import {
  DEFAULT_SCORING_OPTIONS,
  type ScoredCandidate,
} from '../../../shared/library/scoring'
import { ItemChanges } from '../catalog/catalog-store'
import { transaction } from '../db/database'
import { ProviderAuthError } from '../providers/http/provider-http'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import { hasAbsolute, mapEpisodes } from './episode-mapping'
import {
  type IdentifyStore,
  type IdentifyTarget,
  storedCandidate,
} from './identify-store'
import type { ItemImages } from './metadata-writer'
import { type ManualMatchResult, applyManualMatch } from './runner-manual'
import { identifyJav } from './runner-jav'
import { identifyMovie } from './runner-movie'
import { defaultReadText, reusableRef, workerCount } from './runner-rules'
import { identifySeries } from './runner-series'
import type {
  IdentifyRunnerDeps,
  Outcome,
  RunMode,
  RunSummary,
  RunnerContext,
} from './runner-types'

export type { IdentifyRunnerDeps, RunMode, RunSummary } from './runner-types'

/** 远程图片尺寸：缓存失败时直接用远程图。 */
const REMOTE_SIZE = {
  poster: 'w500',
  backdrop: 'w1280',
  still: 'w300',
} as const
/** 下载到本地缓存的原图尺寸（够生成 780w 缩略图）。 */
const CACHE_SIZE = { poster: 'w780', backdrop: 'w1280' } as const

/** 识别与刮削执行器。 */
export class IdentifyRunner implements RunnerContext {
  readonly readText: (path: string) => Promise<string | undefined>
  readonly now: () => number
  private readonly log: (message: string) => void

  constructor(readonly deps: IdentifyRunnerDeps) {
    this.readText = deps.readText ?? defaultReadText
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
  }

  /**
   * 批量执行。令牌无效（ProviderAuthError）时立即中止并抛出；
   * 单个条目的网络错误只计入 failed，不影响其他条目。
   */
  async run(
    targets: IdentifyTarget[],
    mode: RunMode,
    options: {
      signal?: AbortSignal
      concurrency?: number
      onProgress?: (summary: RunSummary) => void
    } = {}
  ): Promise<RunSummary> {
    const summary: RunSummary = {
      total: targets.length,
      done: 0,
      matched: 0,
      review: 0,
      unmatched: 0,
      failed: 0,
      changes: new ItemChanges(),
    }
    let next = 0
    let fatal: unknown
    const worker = async (): Promise<void> => {
      while (next < targets.length && fatal === undefined) {
        const target = targets[next++]
        options.signal?.throwIfAborted()
        try {
          const outcome = await this.processTarget(
            target,
            mode,
            summary.changes,
            options.signal
          )
          if (outcome !== 'skipped') summary[outcome]++
        } catch (error) {
          if (options.signal?.aborted) throw error
          if (error instanceof ProviderAuthError) {
            fatal = error
            return
          }
          summary.failed++
          this.log(`识别条目 ${target.id} 失败：${(error as Error).message}`)
        }
        summary.done++
        options.onProgress?.(summary)
      }
    }
    await Promise.all(
      Array.from(
        { length: workerCount(options.concurrency, targets.length) },
        worker
      )
    )
    if (fatal !== undefined) throw fatal
    return summary
  }

  /** 处理一个顶层条目。 */
  private async processTarget(
    target: IdentifyTarget,
    mode: RunMode,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<Outcome> {
    // 已有匹配：识别模式下只补元数据（新增的集等），刷新模式下重新拉取
    const reuse = reusableRef(target, mode)
    if (reuse) {
      await this.applyRef(
        target,
        reuse.ref,
        reuse.state,
        undefined,
        changes,
        signal
      )
      return 'matched'
    }
    if (mode === 'refresh' || target.matchState === 'locked') return 'skipped'
    if (target.source === 'jav')
      return identifyJav(this, target, changes, signal)
    return target.type === 'movie'
      ? identifyMovie(this, target, changes, signal)
      : identifySeries(this, target, changes, signal)
  }

  // —————————————————————————— 写入 ——————————————————————————

  /** 写入待确认 / 未匹配状态与候选，清掉旧元数据。 */
  writeUndecided(
    target: IdentifyTarget,
    candidates: ScoredCandidate[],
    changes: ItemChanges,
    state: 'review' | 'unmatched' = 'unmatched'
  ): Outcome {
    const now = this.now()
    transaction(this.deps.db, () => {
      this.deps.store.writeUndecided(
        target.id,
        state,
        candidates.slice(0, DEFAULT_SCORING_OPTIONS.reviewLimit),
        now
      )
      this.deps.writer.clearTitle(target.id, now)
      for (const child of this.deps.store.children(target.id)) {
        this.deps.writer.clearChild(child.id)
      }
    })
    changes.touch(target.id)
    return state
  }

  /**
   * 应用一个确定的匹配：取元数据 → 写条目（+ 季 / 集）→ 缓存海报与背景图。
   * 元数据源查不到这个 id 时抛 not-found。
   */
  async applyRef(
    target: IdentifyTarget,
    ref: MediaRef,
    state: 'auto' | 'locked',
    result: IdentifyResult | undefined,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<MediaMetadata> {
    const meta = await this.metadataOf(ref, signal)
    if (!meta) {
      const where = ref.provider === 'jav' ? '番号站点' : 'TMDB'
      throw new LibraryError(
        'not-found',
        `${where}上找不到 ${ref.kind} ${ref.id}`
      )
    }
    const children =
      ref.kind === 'tv' ? this.deps.store.children(target.id) : []
    const seasons =
      ref.kind === 'tv'
        ? await this.fetchSeasons(meta, children, signal)
        : undefined

    const poster = meta.images.find(i => i.role === 'poster')
    const backdrop = meta.images.find(i => i.role === 'backdrop')
    const logo = meta.images.find(i => i.role === 'logo')
    const remote: ItemImages = {
      poster: poster
        ? TmdbProvider.imageUrl(poster.path, REMOTE_SIZE.poster)
        : null,
      backdrop: backdrop
        ? TmdbProvider.imageUrl(backdrop.path, REMOTE_SIZE.backdrop)
        : null,
      logo: logo ? TmdbProvider.imageUrl(logo.path, 'original') : null,
    }
    const scored = result?.status === 'matched' ? result.scored : undefined
    const now = this.now()
    transaction(this.deps.db, () => {
      this.deps.store.writeMatch(
        target.id,
        ref,
        state,
        scored?.score ?? 1,
        storedCandidate(
          {
            ref,
            title: meta.title,
            originalTitle: meta.originalTitle,
            year: meta.year,
            posterPath: poster?.path,
          },
          scored?.breakdown
        ),
        now
      )
      this.deps.writer.writeTitle(target.id, meta, state, remote, now)
      if (seasons) this.writeChildren(children, seasons, now)
    })
    changes.touch(target.id)

    // 海报 / 背景图下载到本地缓存，成功后换成 yingbox-media:// 地址
    if (this.deps.images && (poster || backdrop)) {
      const urls = {
        poster: poster && TmdbProvider.imageUrl(poster.path, CACHE_SIZE.poster),
        backdrop:
          backdrop && TmdbProvider.imageUrl(backdrop.path, CACHE_SIZE.backdrop),
      }
      const cached = await this.deps.images.ensure(
        [urls.poster, urls.backdrop].filter((u): u is string => Boolean(u)),
        signal
      )
      let cachedPoster = urls.poster ? cached.get(urls.poster) : null
      // 派生海报（番号封面裁右侧）加工失败时退回下一张海报（站点自带的小图）
      const fallback = meta.images.filter(i => i.role === 'poster')[1]
      if (!cachedPoster && fallback) {
        const url = TmdbProvider.imageUrl(fallback.path, CACHE_SIZE.poster)
        cachedPoster = (await this.deps.images.ensure([url], signal)).get(url)
      }
      this.deps.writer.writeImages(target.id, {
        poster: cachedPoster ?? null,
        backdrop: urls.backdrop ? cached.get(urls.backdrop) : null,
      })
    }
    return meta
  }

  /** 按引用的来源取元数据：番号走番号站点，其余走 TMDB。 */
  private metadataOf(
    ref: MediaRef,
    signal?: AbortSignal
  ): Promise<MediaMetadata | null> {
    if (ref.provider !== 'jav') return this.deps.provider.metadata(ref, signal)
    return this.deps.jav
      ? this.deps.jav.metadata(ref.id, signal)
      : Promise.resolve(null)
  }

  /** 取本地出现过的各季详情（绝对集数先换算成季 / 集）。 */
  private async fetchSeasons(
    meta: MediaMetadata,
    children: ReturnType<IdentifyStore['children']>,
    signal?: AbortSignal
  ): Promise<{
    bySeason: Map<number, SeasonMetadata>
    mapping: ReturnType<typeof mapEpisodes>
  }> {
    const order = hasAbsolute(children)
      ? await this.deps.provider.absoluteOrder(meta, signal)
      : []
    const mapping = mapEpisodes(children, order)
    const known = new Set((meta.seasons ?? []).map(s => s.season))
    const wanted = new Set<number>()
    for (const c of children) {
      if (c.type === 'season' && c.season !== null) wanted.add(c.season)
    }
    for (const m of mapping) wanted.add(m.position.season)
    const bySeason = new Map<number, SeasonMetadata>()
    await Promise.all(
      [...wanted]
        .filter(n => known.has(n))
        .map(async n => {
          const season = await this.deps.provider.season(meta.ref.id, n, signal)
          if (season) bySeason.set(n, season)
        })
    )
    return { bySeason, mapping }
  }

  /** 写季 / 集；元数据源里没有的季 / 集清空元数据。 */
  private writeChildren(
    children: ReturnType<IdentifyStore['children']>,
    seasons: Awaited<ReturnType<IdentifyRunner['fetchSeasons']>>,
    now: number
  ): void {
    const { writer } = this.deps
    const mapped = new Map(seasons.mapping.map(m => [m.itemId, m]))
    for (const child of children) {
      if (child.type === 'season') {
        const season =
          child.season === null ? undefined : seasons.bySeason.get(child.season)
        if (!season) {
          writer.clearChild(child.id)
          continue
        }
        writer.writeSeason(
          child.id,
          season,
          season.posterPath
            ? TmdbProvider.imageUrl(season.posterPath, REMOTE_SIZE.poster)
            : null,
          now
        )
        continue
      }
      const m = mapped.get(child.id)
      const episode =
        m &&
        seasons.bySeason
          .get(m.position.season)
          ?.episodes.find(e => e.episode === m.position.episode)
      if (!m || !episode) {
        writer.clearChild(child.id)
        continue
      }
      writer.writeEpisode(
        child.id,
        episode,
        episode.stillPath
          ? TmdbProvider.imageUrl(episode.stillPath, REMOTE_SIZE.still)
          : null,
        m.mapped,
        now
      )
    }
  }

  // —————————————————————————— 手动匹配 ——————————————————————————

  /** 手动匹配一个顶层条目（见 runner-manual）。 */
  applyManual(
    target: IdentifyTarget,
    request: ApplyMatchRequest,
    signal?: AbortSignal
  ): Promise<ManualMatchResult> {
    return applyManualMatch(this, target, request, signal)
  }
}
