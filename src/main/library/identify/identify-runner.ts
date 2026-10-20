/**
 * 识别与刮削的执行器：对一批顶层条目跑识别链，拉元数据入库，缓存海报 / 背景图。
 *
 * - 电影：按文件分组识别（同一部片的多个版本解析结果相同，只识别一次）；
 *   P2 把同名无年份的不同影片临时合并在一个条目里，这里识别出不同 provider id 时拆成多个条目；
 * - 剧集：在剧集文件夹层识别一次（tvshow.nfo、文件夹名、各集文件名里的剧名都参与），
 *   用本地季 / 集校验候选，匹配后按 季 / 集（绝对集数按剧集分组顺序）写每季每集的元数据；
 * - 锁定的条目永不被自动识别覆盖，只在刷新元数据时更新元数据本身。
 *
 * 条目之间并发执行，网络请求统一经 ProviderHttp 限速；数据库写入是同步的短事务。
 */
import { readFile } from 'node:fs/promises'
import {
  type IdentifyResult,
  type LocalEpisodes,
  identify,
  parseNfo,
} from '../../../shared/library/identify'
import type { NfoInfo } from '../../../shared/library/identify'
import { LibraryError } from '../../../shared/library/ipc'
import type { ApplyMatchRequest } from '../../../shared/library/ipc'
import {
  type ParsedEpisode,
  type ParsedMedia,
  parseMediaPath,
} from '../../../shared/library/parser'
import type {
  MediaMetadata,
  MediaRef,
  SeasonMetadata,
} from '../../../shared/library/provider'
import {
  DEFAULT_SCORING_OPTIONS,
  type ScoredCandidate,
  normalizeTitle,
} from '../../../shared/library/scoring'
import { ItemChanges } from '../catalog/catalog-store'
import { type LibraryDb, transaction } from '../db/database'
import type { ImageCache } from '../images/image-cache'
import type { OpenSubtitlesHashLookup } from '../providers/opensubtitles/os-hash-lookup'
import { ProviderAuthError } from '../providers/http/provider-http'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import { hasAbsolute, mapEpisodes, summarizeEpisodes } from './episode-mapping'
import {
  type IdentifyStore,
  type IdentifyTarget,
  type TargetFile,
  storedCandidate,
} from './identify-store'
import type { ItemImages, MetadataWriter } from './metadata-writer'

/** 执行器依赖。 */
export interface IdentifyRunnerDeps {
  db: LibraryDb
  store: IdentifyStore
  writer: MetadataWriter
  provider: TmdbProvider
  hashLookup?: OpenSubtitlesHashLookup
  images?: ImageCache
  /** 读 NFO 文本；读不到返回 undefined。 */
  readText?: (path: string) => Promise<string | undefined>
  /** 探测视频时长（秒）。 */
  probeDuration?: (path: string) => Promise<number | undefined>
  /** 计算 OpenSubtitles moviehash（文件还没有指纹时）。 */
  fingerprint?: (path: string) => Promise<string | undefined>
  now?: () => number
  log?: (message: string) => void
}

/** 一次批量执行的统计。 */
export interface RunSummary {
  total: number
  done: number
  matched: number
  review: number
  unmatched: number
  failed: number
  /** 顶层条目变化（推送 items-changed 用）。 */
  changes: ItemChanges
}

/** 执行模式：identify 识别（已自动匹配的只补季 / 集）；force 全部重识别；refresh 只刷新元数据。 */
export type RunMode = 'identify' | 'force' | 'refresh'

/** 单个条目的结果。 */
type Outcome = 'matched' | 'review' | 'unmatched' | 'skipped'

/** NFO 最大读取字节。 */
const NFO_MAX_BYTES = 1024 * 1024
/** 远程图片尺寸：缓存失败时直接用远程图。 */
const REMOTE_SIZE = {
  poster: 'w500',
  backdrop: 'w1280',
  still: 'w300',
} as const
/** 下载到本地缓存的原图尺寸（够生成 780w 缩略图）。 */
const CACHE_SIZE = { poster: 'w780', backdrop: 'w1280' } as const

async function defaultReadText(path: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(path)
    if (buffer.length > NFO_MAX_BYTES) return undefined
    return buffer.toString('utf8')
  } catch {
    return undefined
  }
}

/** 去掉扩展名。 */
const stem = (name: string): string => name.replace(/\.[^.]+$/, '')

/**
 * 文件分组键：同一目录下解析结果相同（忽略分段号）的文件一起识别——同一部片的多个版本 / 分段。
 * 不同目录的同名无年份文件可能是不同影片（P2 临时合并的情况），各自识别。
 */
function groupKey(file: TargetFile): string {
  const p = file.parsed!
  return JSON.stringify([file.dir, p.title, p.altTitle, p.year, p.ids])
}

const refKey = (ref: MediaRef): string => `${ref.kind}:${ref.id}`

/** 识别与刮削执行器。 */
export class IdentifyRunner {
  private readonly readText: (path: string) => Promise<string | undefined>
  private readonly now: () => number
  private readonly log: (message: string) => void

  constructor(private readonly deps: IdentifyRunnerDeps) {
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
        {
          length: Math.max(
            1,
            Math.min(options.concurrency ?? 8, targets.length)
          ),
        },
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
    if (
      target.tmdbId &&
      (mode === 'refresh' ||
        target.matchState === 'locked' ||
        (mode === 'identify' && target.matchState === 'auto'))
    ) {
      const ref: MediaRef = {
        provider: 'tmdb',
        kind: target.type === 'movie' ? 'movie' : 'tv',
        id: target.tmdbId,
      }
      const state = target.matchState === 'locked' ? 'locked' : 'auto'
      await this.applyRef(target, ref, state, undefined, changes, signal)
      return 'matched'
    }
    if (mode === 'refresh' || target.matchState === 'locked') return 'skipped'
    return target.type === 'movie'
      ? this.identifyMovie(target, changes, signal)
      : this.identifySeries(target, changes, signal)
  }

  // —————————————————————————— 电影 ——————————————————————————

  private async identifyMovie(
    target: IdentifyTarget,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<Outcome> {
    const files = this.deps.store.files(target.id)
    const groups = new Map<string, TargetFile[]>()
    for (const f of files) {
      if (!f.parsed || f.parsed.type === 'extra') continue
      const key = groupKey(f)
      const list = groups.get(key)
      if (list) list.push(f)
      else groups.set(key, [f])
    }
    if (!groups.size) return this.writeUndecided(target, [], changes)

    const results: Array<{ files: TargetFile[]; result: IdentifyResult }> = []
    for (const group of groups.values()) {
      results.push({
        files: group,
        result: await this.identifyMovieFile(group[0], signal),
      })
    }

    // 按匹配到的条目归并文件
    const byRef = new Map<
      string,
      { ref: MediaRef; files: TargetFile[]; result: IdentifyResult }
    >()
    for (const r of results) {
      if (r.result.status !== 'matched') continue
      const key = refKey(r.result.ref)
      const entry = byRef.get(key)
      if (entry) entry.files.push(...r.files)
      else
        byRef.set(key, {
          ref: r.result.ref,
          files: [...r.files],
          result: r.result,
        })
    }
    if (!byRef.size) {
      // 都没匹配上：取最好的一组候选
      const best =
        results.map(r => r.result).find(r => r.status === 'review') ??
        results[0].result
      const candidates =
        best.status === 'review' || best.status === 'unmatched'
          ? best.candidates
          : []
      return best.status === 'review'
        ? this.writeUndecided(target, candidates, changes, 'review')
        : this.writeUndecided(target, candidates, changes)
    }

    // 文件最多的匹配留在原条目，其余拆出去（同名无年份临时合并的不同影片）
    const ordered = [...byRef.values()].sort(
      (a, b) => b.files.length - a.files.length
    )
    const [main, ...others] = ordered
    for (const other of others) {
      const newId = transaction(this.deps.db, () =>
        this.deps.store.splitMovie(
          target,
          other.files.map(f => f.id),
          other.ref,
          this.now()
        )
      )
      changes.added.add(newId)
      const split = this.deps.store.target(newId)!
      await this.applyRef(
        split,
        other.ref,
        'auto',
        other.result,
        changes,
        signal
      )
    }
    await this.applyRef(target, main.ref, 'auto', main.result, changes, signal)
    return 'matched'
  }

  /** 识别电影的一个代表文件。 */
  private async identifyMovieFile(
    file: TargetFile,
    signal?: AbortSignal
  ): Promise<IdentifyResult> {
    const parsed = file.parsed!
    const nfo = await this.movieNfo(file)
    const needSearch = !nfo?.ids.tmdb && !nfo?.ids.imdb && !parsed.ids
    const [runtimeMinutes, fileHash] = await Promise.all([
      needSearch ? this.runtimeOf(file) : undefined,
      needSearch ? this.hashOf(file) : undefined,
    ])
    return identify(
      { parsed, nfo, runtimeMinutes, fileHash },
      {
        provider: this.deps.provider,
        hashLookup: this.deps.hashLookup?.configured
          ? this.deps.hashLookup
          : undefined,
        secondaryLanguage: this.deps.provider.secondaryLanguage,
        signal,
      }
    )
  }

  /** 电影 NFO：同名 .nfo 优先，其次 movie.nfo。 */
  private async movieNfo(file: TargetFile): Promise<NfoInfo | undefined> {
    const nfos = this.deps.store.nfoFiles(file.dir)
    if (!nfos.size) return undefined
    const path =
      nfos.get(`${stem(file.name)}.nfo`.toLowerCase()) ?? nfos.get('movie.nfo')
    const text = path ? await this.readText(path) : undefined
    return text ? parseNfo(text) : undefined
  }

  /** 文件时长（分钟）：库里有就用，没有就探测并记下。 */
  private async runtimeOf(file: TargetFile): Promise<number | undefined> {
    let seconds = file.duration ?? undefined
    if (seconds === undefined && this.deps.probeDuration) {
      seconds = await this.deps.probeDuration(file.displayPath)
      if (seconds !== undefined) this.deps.store.setDuration(file.id, seconds)
    }
    return seconds ? Math.round(seconds / 60) : undefined
  }

  /** 文件哈希：只在配置了 OpenSubtitles 时计算。 */
  private async hashOf(
    file: TargetFile
  ): Promise<{ hash: string; size: number } | undefined> {
    if (!this.deps.hashLookup?.configured) return undefined
    let hash = file.fingerprint ?? undefined
    if (!hash && this.deps.fingerprint) {
      hash = await this.deps.fingerprint(file.displayPath)
      if (hash) this.deps.store.setFingerprint(file.id, hash)
    }
    return hash ? { hash, size: file.size } : undefined
  }

  // —————————————————————————— 剧集 ——————————————————————————

  /** 剧集识别输入：代表集解析 + 文件夹名 / 其他写法 + 本地季集 + tvshow.nfo。 */
  private async seriesInput(target: IdentifyTarget): Promise<{
    parsed: ParsedEpisode
    extraTitles: string[]
    episodes?: LocalEpisodes
    nfo?: NfoInfo
  } | null> {
    const files = this.deps.store.files(target.id)
    const parses = files
      .map(f => f.parsed)
      .filter((p): p is ParsedEpisode => p?.type === 'episode')
    // 剧集文件夹（媒体库根下第一层）
    const folderMatch = /^series:\d+:d:(.+)$/.exec(target.localKey)
    const root = this.deps.store.libraryRoot(target.libraryId)
    const folder = folderMatch?.[1]
    const folderParse = folder ? parseMediaPath(`${folder}.mkv`) : undefined

    // 出现次数最多的剧名写法作代表
    const counts = new Map<string, { n: number; parsed: ParsedEpisode }>()
    for (const p of parses) {
      const key = normalizeTitle(p.title || p.altTitle || '')
      if (!key) continue
      const entry = counts.get(key)
      if (entry) entry.n++
      else counts.set(key, { n: 1, parsed: p })
    }
    const ranked = [...counts.values()].sort((a, b) => b.n - a.n)
    let parsed: ParsedEpisode | undefined = ranked[0]?.parsed
    if (!parsed && folderParse && folderParse.type !== 'extra') {
      parsed = {
        type: 'episode',
        title: folderParse.title,
        altTitle: folderParse.altTitle,
        year: folderParse.year,
        ids: folderParse.ids,
        episodes: [],
      }
    }
    if (!parsed) return null
    // 文件名没写年份 / ID 时用文件夹里的
    parsed = {
      ...parsed,
      year: parsed.year ?? folderParse?.year,
      ids: parsed.ids ?? folderParse?.ids,
    }
    const extraTitles = [
      folderParse?.title,
      folderParse?.altTitle,
      ...ranked.slice(1, 3).map(r => r.parsed.title),
    ].filter((t): t is string => Boolean(t))

    let nfo: NfoInfo | undefined
    if (folder && root) {
      const path = this.deps.store
        .nfoFiles(`${root.rootKey}/${folder}`)
        .get('tvshow.nfo')
      const text = path ? await this.readText(path) : undefined
      if (text) nfo = parseNfo(text)
    }
    return {
      parsed,
      extraTitles,
      episodes: summarizeEpisodes(this.deps.store.children(target.id)),
      nfo,
    }
  }

  private async identifySeries(
    target: IdentifyTarget,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<Outcome> {
    const input = await this.seriesInput(target)
    if (!input) return this.writeUndecided(target, [], changes)
    const result = await identify(input, {
      provider: this.deps.provider,
      secondaryLanguage: this.deps.provider.secondaryLanguage,
      signal,
    })
    if (result.status === 'matched') {
      await this.applyRef(target, result.ref, 'auto', result, changes, signal)
      return 'matched'
    }
    if (result.status === 'skipped') return 'skipped'
    return this.writeUndecided(
      target,
      result.candidates,
      changes,
      result.status
    )
  }

  // —————————————————————————— 写入 ——————————————————————————

  private writeUndecided(
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
    const { provider } = this.deps
    const meta = await provider.metadata(ref, signal)
    if (!meta) {
      throw new LibraryError('not-found', `TMDB 上找不到 ${ref.kind} ${ref.id}`)
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
      this.deps.writer.writeImages(target.id, {
        poster: urls.poster ? cached.get(urls.poster) : null,
        backdrop: urls.backdrop ? cached.get(urls.backdrop) : null,
      })
    }
    return meta
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

  /**
   * 手动匹配一个顶层条目。指定 id 时直接应用（默认锁定）；
   * 给搜索词时按该词重新识别，够自信自动应用，否则保存并返回候选。
   */
  async applyManual(
    target: IdentifyTarget,
    request: ApplyMatchRequest,
    signal?: AbortSignal
  ): Promise<{
    status: 'matched' | 'review' | 'unmatched'
    candidates: ScoredCandidate[]
    changes: ItemChanges
  }> {
    const { provider } = this.deps
    const kind = target.type === 'movie' ? 'movie' : 'tv'
    const changes = new ItemChanges()
    const state = request.lock === false ? 'auto' : 'locked'

    let ref: MediaRef | undefined
    if (request.tmdbId) {
      const hit = await provider.details(kind, request.tmdbId, signal)
      ref = hit?.ref
    } else if (request.imdbId || request.tvdbId) {
      const source = request.imdbId ? 'imdb' : 'tvdb'
      const hits = await provider.find(
        source,
        (request.imdbId ?? request.tvdbId)!,
        signal
      )
      ref = hits.find(c => c.ref.kind === kind)?.ref
    }
    if (ref) {
      // 手动指定前先解除锁定状态的限制：用户的选择覆盖之前的锁定
      await this.applyRef(
        { ...target, matchState: 'unmatched' },
        ref,
        state,
        undefined,
        changes,
        signal
      )
      if (state === 'auto') {
        transaction(this.deps.db, () =>
          this.deps.store.setMatchState(target.id, 'auto', this.now())
        )
      }
      return { status: 'matched', candidates: [], changes }
    }
    if (!request.query) {
      throw new LibraryError('not-found', '在 TMDB 上找不到指定的 ID')
    }

    // 按用户给的标题重新识别
    const episodes =
      kind === 'tv'
        ? summarizeEpisodes(this.deps.store.children(target.id))
        : undefined
    const parsed: ParsedMedia =
      kind === 'movie'
        ? {
            type: 'movie',
            title: request.query.title,
            year: request.query.year,
          }
        : {
            type: 'episode',
            title: request.query.title,
            year: request.query.year,
            episodes: [],
          }
    const result = await identify(
      { parsed, episodes },
      {
        provider,
        secondaryLanguage: provider.secondaryLanguage,
        signal,
      }
    )
    if (result.status === 'matched') {
      await this.applyRef(
        { ...target, matchState: 'unmatched' },
        result.ref,
        'auto',
        result,
        changes,
        signal
      )
      if (target.matchState === 'locked') {
        transaction(this.deps.db, () =>
          this.deps.store.setMatchState(target.id, 'auto', this.now())
        )
      }
      return { status: 'matched', candidates: [], changes }
    }
    if (result.status === 'skipped') {
      return { status: 'unmatched', candidates: [], changes }
    }
    // 用户主动搜索：结果当作候选保存，不动锁定状态之外的匹配
    if (target.matchState !== 'locked') {
      this.writeUndecided(target, result.candidates, changes, result.status)
    }
    return { status: result.status, candidates: result.candidates, changes }
  }
}
