/**
 * 电影上线追踪服务：用户加进来的电影，到 TMDB 数字发行日之后每天搜一次 WEB-DL / BluRay 的 115 分享，
 * 默认列成候选等确认（全自动要先选好电影文件夹、分数过线），30 天没找到就停；片库里出现这部电影就算完成。
 *
 * 不依赖 Electron：TMDB、片库、115、闸门、状态读写、时钟都由 index.ts 注入。
 * 115 请求都过剧集追更的闸门，另有每天 {@link MOVIE_SNAPS_PER_DAY} 次的子限额。
 */
import type {
  GrabResult,
  MovieMode,
  MovieSearchHit,
  MovieTrackStatus,
  MoviesOverview,
} from '../../../shared/contract/autograb-upgrade'
import type { NetdiskItem, ShareSnap } from '../../../shared/contract/pan115'
import { type Gate, GateClosed } from '../gate'
import { AUTO_SCORE } from '../match-rules'
import { localDate } from '../schedule-rules'
import {
  BudgetSpent,
  MOVIE_SNAPS_PER_DAY,
  budgetLeft,
} from '../upgrade/quality-rules'
import { createShareScanner } from '../upgrade/share-scan'
import {
  matchMovieFile,
  movieFolderWorthOpening,
  movieKeywords,
  movieNextTry,
} from './movie-rules'
import { advance, applyInfo } from './records'
import { createMovieSaver } from './saver'
import {
  type MovieRecord,
  type MoviesState,
  emptyMoviesState,
  parseMoviesState,
} from './state'
import type { MovieTmdb } from './tmdb'

const DAY = 24 * 3_600_000
/** 还没上线的电影多久向 TMDB 刷新一次发行日期 */
const RECHECK_MS = 3 * DAY
/** 一轮最多搜几部 */
const MAX_SEARCH_PER_TICK = 3
const BLOCK_MS = 7 * DAY

/** 依赖 */
export interface MoviesDeps {
  tmdb: MovieTmdb
  tmdbReady(): boolean
  /** 片库里有没有这部电影（按 TMDB id） */
  inLibrary(tmdbId: number, title: string): Promise<boolean>
  gate(): Promise<Gate>
  pan: {
    loggedIn(): boolean
    pansouReady(): boolean
    search(keyword: string): Promise<NetdiskItem[]>
    snap(url: string, password: string, dirCid: string): Promise<ShareSnap>
    receive(
      url: string,
      password: string,
      fileIds: string[],
      cid: string
    ): Promise<void>
    names(cid: string): Promise<string[]>
    dirPath(cid: string): Promise<string[]>
  }
  /** 按 115 路径通知媒体库扫描 */
  notify(path: string): Promise<void>
  defaultCid(): string
  load(): Promise<unknown>
  save(state: MoviesState): Promise<void>
  now(): number
  emit(): void
  log(message: string): void
}

/** 电影追踪服务 */
export interface MoviesService {
  tick(): Promise<void>
  overview(): Promise<MoviesOverview>
  search(query: string): Promise<MovieSearchHit[]>
  status(tmdbId: number): Promise<MovieTrackStatus | null>
  track(tmdbId: number): Promise<GrabResult>
  untrack(tmdbId: number): Promise<void>
  setMode(tmdbId: number, mode: MovieMode): Promise<GrabResult>
  setFolder(cid: string, cidName: string): Promise<void>
  grab(tmdbId: number, index: number): Promise<GrabResult>
  retry(tmdbId: number): Promise<void>
}

const ORDER: Record<MovieTrackStatus, number> = {
  found: 0,
  saved: 1,
  searching: 2,
  upcoming: 3,
  notFound: 4,
  done: 5,
}

/** 创建电影追踪服务 */
export function createMoviesService(deps: MoviesDeps): MoviesService {
  let state = emptyMoviesState(deps.now())
  let loaded: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let current: Promise<void> | null = null
  let running = false

  function dirty(): void {
    deps.emit()
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void deps
        .save(state)
        .catch(e => deps.log(`保存失败：${(e as Error).message}`))
    }, 500)
  }

  function ensureLoaded(): Promise<void> {
    loaded ??= deps
      .load()
      .then(raw => void (state = parseMoviesState(raw, deps.now())))
      .catch(() => void (state = emptyMoviesState(deps.now())))
    return loaded
  }

  const scanner = createShareScanner({
    search: keyword => deps.pan.search(keyword),
    snap: async (item, dir) => {
      const gate = await deps.gate()
      if (budgetLeft(state.budget, deps.now(), MOVIE_SNAPS_PER_DAY) <= 0)
        throw new BudgetSpent('电影追踪')
      state.budget.snaps++
      return gate.run('snap', () =>
        deps.pan.snap(item.url, item.receiveCode, dir)
      )
    },
    blocked: code => (state.blacklist[code] ?? 0) > deps.now(),
    block: code => {
      state.blacklist[code] = deps.now() + BLOCK_MS
      dirty()
    },
    now: deps.now,
  })

  const targetCid = (): string => {
    const cid = state.cid || deps.defaultCid()
    return /^\d+$/.test(cid) ? cid : '0'
  }

  const saver = createMovieSaver({ deps, targetCid, dirty })

  async function searchOne(record: MovieRecord, now: number): Promise<void> {
    const target = {
      title: record.title,
      originalTitle: record.originalTitle,
      year: record.year,
    }
    const result = await scanner.scan({
      keywords: movieKeywords(target),
      title: record.title,
      openFolder: name => movieFolderWorthOpening(name, target),
      match: (file, context) => {
        const m = matchMovieFile(file, target, context, true)
        return m.ok ? m : null
      },
    })
    record.attempts++
    record.candidates = result.candidates
    record.error = result.note
    if (result.candidates.length) {
      record.status = 'found'
      record.nextTry = null
    } else {
      record.nextTry = movieNextTry(record.searchFrom ?? localDate(now), now)
      if (record.nextTry === null) record.status = 'notFound'
    }
    dirty()
    const best = record.candidates[0]
    if (
      record.status === 'found' &&
      record.mode === 'auto' &&
      state.cid &&
      best.score >= AUTO_SCORE
    )
      await saver.grab(record, 0)
  }

  async function runOnce(): Promise<void> {
    await ensureLoaded()
    const records = Object.values(state.movies).filter(r => r.status !== 'done')
    if (!records.length) return
    running = true
    deps.emit()
    try {
      const now = deps.now()
      for (const record of records) {
        if (await deps.inLibrary(record.tmdbId, record.title)) {
          Object.assign(record, { status: 'done', nextTry: null, error: null })
          dirty()
          continue
        }
        if (
          record.status === 'upcoming' &&
          now - record.checkedAt >= RECHECK_MS &&
          deps.tmdbReady()
        ) {
          const info = await deps.tmdb.movie(record.tmdbId).catch(() => null)
          if (info) applyInfo(record, info, now)
          dirty()
        }
        if (advance(record, now)) dirty()
      }
      const gate = await deps.gate()
      if (gate.paused() || !deps.pan.loggedIn() || !deps.pan.pansouReady())
        return
      for (const record of records.filter(r => r.status === 'saved'))
        await saver
          .followSaved(record, now, gate)
          .catch(e => deps.log((e as Error).message))
      const due = records
        .filter(
          r =>
            r.status === 'searching' && r.nextTry !== null && r.nextTry <= now
        )
        .sort((a, b) => (a.nextTry ?? 0) - (b.nextTry ?? 0))
        .slice(0, MAX_SEARCH_PER_TICK)
      for (const record of due) {
        if (gate.paused()) break
        try {
          await searchOne(record, deps.now())
        } catch (error) {
          if (error instanceof GateClosed || error instanceof BudgetSpent) break
          record.error = (error as Error).message
          record.nextTry = movieNextTry(
            record.searchFrom ?? localDate(now),
            deps.now()
          )
          if (record.nextTry === null) record.status = 'notFound'
          dirty()
        }
      }
    } catch (error) {
      deps.log(`电影追踪一轮失败：${(error as Error).message}`)
    } finally {
      running = false
      deps.emit()
    }
  }

  function tick(): Promise<void> {
    current ??= runOnce().finally(() => (current = null))
    return current
  }

  const recordOf = (tmdbId: number): MovieRecord | undefined =>
    state.movies[String(tmdbId)]

  return {
    tick,
    async overview(): Promise<MoviesOverview> {
      await ensureLoaded()
      const gate = await deps.gate()
      return {
        cid: state.cid,
        cidName: state.cidName,
        ready: {
          loggedIn: deps.pan.loggedIn(),
          pansou: deps.pan.pansouReady(),
          tmdb: deps.tmdbReady(),
        },
        pauseReason: gate.paused()
          ? '115 闸门暂停中（和剧集追更共用），恢复后继续'
          : null,
        movies: Object.values(state.movies)
          .sort(
            (a, b) =>
              ORDER[a.status] - ORDER[b.status] ||
              (a.releaseDate ?? '9').localeCompare(b.releaseDate ?? '9') ||
              b.addedAt - a.addedAt
          )
          .map(
            ({
              originalTitle: _a,
              premiere: _b,
              searchFrom: _c,
              checkedAt: _d,
              savedAt: _e,
              savedName: _f,
              savedCid: _g,
              notified: _h,
              ...rest
            }) => rest
          ),
        running,
      }
    },
    search: query => deps.tmdb.search(query),
    async status(tmdbId: number): Promise<MovieTrackStatus | null> {
      await ensureLoaded()
      return recordOf(tmdbId)?.status ?? null
    },
    async track(tmdbId: number): Promise<GrabResult> {
      await ensureLoaded()
      if (recordOf(tmdbId)) return { ok: true }
      if (!deps.tmdbReady())
        return { ok: false, error: '先在设置里填写 TMDB 令牌' }
      const info = await deps.tmdb.movie(tmdbId).catch(() => null)
      if (!info) return { ok: false, error: 'TMDB 上找不到这部电影' }
      const now = deps.now()
      const record: MovieRecord = {
        tmdbId,
        title: info.title,
        originalTitle: info.originalTitle,
        year: info.year,
        poster: info.poster,
        premiere: info.premiere,
        releaseDate: null,
        dateSource: null,
        searchFrom: null,
        checkedAt: now,
        mode: 'confirm',
        status: 'upcoming',
        attempts: 0,
        nextTry: null,
        candidates: [],
        error: null,
        addedAt: now,
        savedAt: null,
        savedName: null,
        savedCid: null,
        notified: false,
      }
      applyInfo(record, info, now)
      state.movies[String(tmdbId)] = record
      advance(record, now)
      dirty()
      void tick()
      return { ok: true }
    },
    async untrack(tmdbId: number): Promise<void> {
      await ensureLoaded()
      if (!recordOf(tmdbId)) return
      delete state.movies[String(tmdbId)]
      dirty()
    },
    async setMode(tmdbId: number, mode: MovieMode): Promise<GrabResult> {
      await ensureLoaded()
      const record = recordOf(tmdbId)
      if (!record) return { ok: false, error: '没有在追踪这部电影' }
      if (mode === 'auto' && !state.cid)
        return { ok: false, error: '全自动要先选一个电影的 115 文件夹' }
      record.mode = mode
      dirty()
      return { ok: true }
    },
    async setFolder(cid: string, cidName: string): Promise<void> {
      await ensureLoaded()
      state.cid = cid
      state.cidName = cidName
      dirty()
    },
    async grab(tmdbId: number, index: number): Promise<GrabResult> {
      await ensureLoaded()
      const record = recordOf(tmdbId)
      if (!record) return { ok: false, error: '没有在追踪这部电影' }
      if ((await deps.gate()).paused())
        return { ok: false, error: '115 闸门暂停中，恢复后再试' }
      return saver.grab(record, index)
    },
    async retry(tmdbId: number): Promise<void> {
      await ensureLoaded()
      const record = recordOf(tmdbId)
      if (!record || record.status === 'saved' || record.status === 'done')
        return
      const now = deps.now()
      if (record.status === 'upcoming') record.checkedAt = 0
      else
        Object.assign(record, {
          status: 'searching',
          searchFrom: localDate(now),
          nextTry: now,
          candidates: [],
          error: null,
        })
      dirty()
      void tick()
    },
  }
}
