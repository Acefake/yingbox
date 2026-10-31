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

/** 要用户处理的状态 */
const PENDING_STATUSES: ReadonlySet<EpisodeRecord['status']> = new Set([
  'found',
  'noSpace',
  'notFound',
])

/** 要用户处理的集数：只数实际在追的剧（侧栏角标与待处理列表同口径） */
export function pendingCount(state: AutograbState): number {
  return Object.values(state.episodes).filter(
    r =>
      PENDING_STATUSES.has(r.status) &&
      seriesModeOf(state, r.seriesId) !== 'off'
  ).length
}

/** 总览里列的集：新播出的在前，最多 {@link MAX_EPISODES} 集，超出的待处理集也要列（角标数得到的，页面上要找得到） */
function listedEpisodes(state: AutograbState): EpisodeRecord[] {
  const sorted = Object.values(state.episodes)
    .filter(r => seriesModeOf(state, r.seriesId) !== 'off')
    .sort((a, b) => b.airDate.localeCompare(a.airDate) || b.episode - a.episode)
  return [
    ...sorted.slice(0, MAX_EPISODES),
    ...sorted.slice(MAX_EPISODES).filter(r => PENDING_STATUSES.has(r.status)),
  ]
}

/** 总览里状态以外的部分 */
export interface OverviewContext {
  ready: AutograbOverview['ready']
  airing: Map<number, string>
  nextAir: Map<number, string>
  lastRunAt: number | null
  nextRunAt: number | null
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
    series: seriesList(state, ctx.airing, ctx.nextAir),
    episodes: listedEpisodes(state).map(episodeView),
    pendingCount: pendingCount(state),
    lastRunAt: ctx.lastRunAt,
    nextRunAt: ctx.nextRunAt,
    running: ctx.running,
    defaultFolder: ctx.defaultFolder,
  }
}
