/**
 * 电影追踪的策略规则与界面视图（纯函数）：全局策略 + 单部设置 → 实际的方式与资源偏好；
 * 状态 → 界面上的电影列表（去掉只在主进程用的字段，补上实际方式）。
 */
import type {
  MovieMode,
  MovieTrackStatus,
  TrackedMovie,
} from '../../../shared/contract/autograb-upgrade'
import { effectiveMode } from '../../../shared/contract/grab-policy'
import { type GrabPrefs, mergePrefs } from '../../../shared/contract/grab-prefs'
import type { MovieRecord, MoviesState } from './state'

/** 这部电影实际的方式（电影的全局策略没有「不追」） */
export function movieModeOf(
  state: MoviesState,
  record: MovieRecord
): MovieMode {
  const mode = effectiveMode(record.mode, state.policy)
  return mode === 'auto' ? 'auto' : 'confirm'
}

/** 这部电影实际用的资源偏好：全局 + 这部电影的覆盖 */
export function moviePrefsOf(
  state: MoviesState,
  record: MovieRecord
): GrabPrefs {
  return mergePrefs(state.policy.prefs, record.prefs)
}

const ORDER: Record<MovieTrackStatus, number> = {
  found: 0,
  saved: 1,
  searching: 2,
  upcoming: 3,
  notFound: 4,
  done: 5,
}

/** 界面上的电影列表：有候选的、已转存的在前，再按发行日、加入时间 */
export function movieList(state: MoviesState): TrackedMovie[] {
  return Object.values(state.movies)
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        (a.releaseDate ?? '9').localeCompare(b.releaseDate ?? '9') ||
        b.addedAt - a.addedAt
    )
    .map(record => {
      const {
        originalTitle: _a,
        premiere: _b,
        searchFrom: _c,
        checkedAt: _d,
        savedAt: _e,
        savedName: _f,
        savedCid: _g,
        notified: _h,
        ...rest
      } = record
      return { ...rest, effectiveMode: movieModeOf(state, record) }
    })
}
