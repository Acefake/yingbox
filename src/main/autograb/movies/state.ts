/**
 * 电影上线追踪状态：统一转存到的 115 文件夹、每部电影一条记录、拉黑的分享、每天的子限额，
 * 存在 userData/autograb-movies.json。读的时候逐字段校验，认不出的丢掉。键是 TMDB id（幂等键）。
 */
import {
  MOVIE_MODES,
  type MovieMode,
  type MovieTrackStatus,
  type TrackedMovie,
} from '../../../shared/contract/autograb-upgrade'
import { type Budget, emptyBudget } from '../upgrade/quality-rules'
import { parseCandidates } from '../upgrade/state'

/** 一部电影的记录（比界面多几个内部字段） */
export interface MovieRecord extends TrackedMovie {
  originalTitle: string
  /** 首映日（发行信息缺失时的兜底） */
  premiere: string | null
  /** 这一轮从哪天开始搜（发行日，或用户点重搜那天）；30 天从它算 */
  searchFrom: string | null
  /** 上一次向 TMDB 刷新发行日期的时间 */
  checkedAt: number
  savedAt: number | null
  savedName: string | null
  savedCid: string | null
  notified: boolean
}

/** 整份状态 */
export interface MoviesState {
  version: 1
  cid: string
  cidName: string
  movies: Record<string, MovieRecord>
  blacklist: Record<string, number>
  budget: Budget
}

const STATUSES: readonly MovieTrackStatus[] = [
  'upcoming',
  'searching',
  'found',
  'saved',
  'done',
  'notFound',
]

/** 空状态 */
export function emptyMoviesState(now: number): MoviesState {
  return {
    version: 1,
    cid: '',
    cidName: '',
    movies: {},
    blacklist: {},
    budget: emptyBudget(now),
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0
const nOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const sOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null
const dateOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null

function parseMovie(id: string, raw: unknown): MovieRecord | null {
  if (!isObj(raw) || !/^\d+$/.test(id)) return null
  const status = s(raw.status) as MovieTrackStatus
  if (!STATUSES.includes(status) || !s(raw.title)) return null
  const mode = s(raw.mode) as MovieMode
  const source = s(raw.dateSource)
  return {
    tmdbId: Number(id),
    title: s(raw.title),
    originalTitle: s(raw.originalTitle),
    year: nOrNull(raw.year),
    poster: sOrNull(raw.poster),
    premiere: dateOrNull(raw.premiere),
    releaseDate: dateOrNull(raw.releaseDate),
    dateSource:
      source === 'digital' || source === 'physical' || source === 'premiere'
        ? source
        : null,
    searchFrom: dateOrNull(raw.searchFrom),
    checkedAt: n(raw.checkedAt),
    mode: MOVIE_MODES.includes(mode) ? mode : 'confirm',
    status,
    attempts: n(raw.attempts),
    nextTry: nOrNull(raw.nextTry),
    candidates: parseCandidates(raw.candidates),
    error: sOrNull(raw.error),
    addedAt: n(raw.addedAt),
    savedAt: nOrNull(raw.savedAt),
    savedName: sOrNull(raw.savedName),
    savedCid: sOrNull(raw.savedCid),
    notified: raw.notified === true,
  }
}

/** 文件内容 → 状态 */
export function parseMoviesState(raw: unknown, now: number): MoviesState {
  const state = emptyMoviesState(now)
  if (!isObj(raw) || raw.version !== 1) return state
  state.cid = /^\d*$/.test(s(raw.cid)) ? s(raw.cid) : ''
  state.cidName = s(raw.cidName)
  if (isObj(raw.movies))
    for (const [id, value] of Object.entries(raw.movies)) {
      const record = parseMovie(id, value)
      if (record) state.movies[id] = record
    }
  if (isObj(raw.blacklist))
    for (const [code, until] of Object.entries(raw.blacklist))
      if (typeof until === 'number' && until > now)
        state.blacklist[code] = until
  if (isObj(raw.budget))
    state.budget = { day: s(raw.budget.day), snaps: n(raw.budget.snaps) }
  return state
}
