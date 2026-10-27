/**
 * 追更状态 → 界面总览（纯函数）：剧列表、最近各集（去掉只在主进程用的字段，补上能否撤销）。
 */
import type {
  AutograbEpisode,
  AutograbOverview,
} from '../../shared/contract/autograb'
import { seriesModeOf } from './policy'
import { seriesList } from './records'
import { canRevert } from './revert'
import type { AutograbState, EpisodeRecord } from './state'

/** 面板上最多列几集 */
const MAX_EPISODES = 60

/** 一条记录给界面看的部分 */
export function episodeView(record: EpisodeRecord): AutograbEpisode {
  return {
    key: record.key,
    seriesId: record.seriesId,
    seriesTitle: record.seriesTitle,
    season: record.season,
    episode: record.episode,
    airDate: record.airDate,
    status: record.status,
    attempts: record.attempts,
    nextTry: record.nextTry,
    candidates: record.candidates,
    error: record.error,
    notified: record.notified,
    revertable: canRevert(record),
  }
}

/** 总览里状态以外的部分 */
export interface OverviewContext {
  ready: AutograbOverview['ready']
  airing: Map<number, string>
  running: boolean
  defaultFolder: AutograbOverview['defaultFolder']
}

/** 组装总览：只列实际在追的剧的集，新播出的在前 */
export function buildOverview(
  state: AutograbState,
  ctx: OverviewContext
): AutograbOverview {
  return {
    enabled: state.enabled,
    pausedUntil: state.gate.pausedUntil,
    pauseReason: state.gate.pauseReason,
    spacePaused: state.spacePause,
    policy: state.policy,
    prefs: state.policy.prefs,
    ready: ctx.ready,
    today: { snaps: state.gate.snaps, receives: state.gate.receives },
    series: seriesList(state, ctx.airing),
    episodes: Object.values(state.episodes)
      .filter(r => seriesModeOf(state, r.seriesId) !== 'off')
      .sort(
        (a, b) => b.airDate.localeCompare(a.airDate) || b.episode - a.episode
      )
      .slice(0, MAX_EPISODES)
      .map(episodeView),
    running: ctx.running,
    defaultFolder: ctx.defaultFolder,
  }
}
