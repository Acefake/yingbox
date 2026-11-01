/**
 * 剧集追更的策略规则（纯函数）：全局策略 + 每部剧的设置 → 这部剧实际的方式、确认门槛、资源偏好；
 * 改一部剧的设置 / 改全局策略时的校验（全自动不能存到根目录）。
 *
 * 没单独设过的在播剧也按全局方式追（{@link seriesModeOf} 对没有设置的剧返回全局方式）。
 */
import type { CalendarEpisode } from '../../shared/library/ipc'
import { normalizeCid } from '../../shared/netdisk/target-folder'
import type { SeriesCategory } from '../../shared/contract/series-category'
import type {
  AutograbMode,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../shared/contract/autograb'
import { mergePrefs } from '../../shared/contract/autograb-prefs'
import {
  type GrabPolicyPatch,
  effectiveMode,
} from '../../shared/contract/grab-policy'
import type { GrabPrefs } from '../../shared/contract/grab-prefs'
import { type AutograbState, type SeriesSetting, ensureSetting } from './state'

const settingOf = (
  state: AutograbState,
  seriesId: number
): SeriesSetting | undefined => state.series[String(seriesId)]

/** 这部剧实际的追更方式 */
export function seriesModeOf(
  state: AutograbState,
  seriesId: number
): AutograbMode {
  return effectiveMode(settingOf(state, seriesId)?.mode, state.policy)
}

/** 这部剧全自动前要手动确认几集：自己的门槛（迁移前的老剧）> 全局「新剧先确认」 */
export function confirmFirstOf(
  state: AutograbState,
  setting: SeriesSetting | undefined
): number {
  return setting?.confirmFirst ?? state.policy.confirmFirst
}

/** 这部剧实际用的资源偏好：全局 + 这部剧的覆盖 */
export function seriesPrefsOf(
  state: AutograbState,
  seriesId: number
): GrabPrefs {
  return mergePrefs(state.policy.prefs, settingOf(state, seriesId)?.prefs)
}

/** 有没有任何剧在追：全局不是「不追」，或有剧单独设了待确认 / 全自动 */
export function anyTracked(state: AutograbState): boolean {
  return (
    state.policy.mode !== 'off' ||
    Object.values(state.series).some(
      s => s.mode !== 'off' && s.mode !== 'inherit'
    )
  )
}

/** 全自动需要的文件夹提示 */
const SERIES_FOLDER_ERROR =
  '全自动要先给这部剧选一个 115 文件夹，或在设置 · 网盘里设剧集默认目录'
const POLICY_FOLDER_ERROR = '全自动要先设剧集默认目录（不能存到 115 根目录）'

/**
 * 改一部剧的设置。设成（或跟随成）全自动而转存目标是根目录时拒绝，什么都不改。
 * @param title 没有设置时新建用的剧名
 * @param targetCid 设置 → 转存目标 cid（"0" = 根目录）
 */
export function applySeriesPatch(
  state: AutograbState,
  seriesId: number,
  title: string,
  patch: AutograbSeriesPatch,
  targetCid: (setting: Pick<SeriesSetting, 'cid'>) => string
): AutograbResult {
  const current = settingOf(state, seriesId) ?? {
    title,
    mode: 'inherit',
    cid: '',
    cidName: '',
    confirmed: 0,
    prefs: {},
  }
  const next: SeriesSetting = { ...current, ...patch }
  if (
    effectiveMode(next.mode, state.policy) === 'auto' &&
    targetCid(next) === '0'
  )
    return { ok: false, error: SERIES_FOLDER_ERROR }
  Object.assign(ensureSetting(state, seriesId, title), next)
  return { ok: true }
}

/**
 * 改全局策略。切全自动而剧集默认目录解析到根目录时拒绝（单独选了文件夹的剧不受影响，
 * 但跟随全局的剧没有地方可存）。
 * @param defaultCid 剧集默认目录 cid（"0" = 根目录）
 */
export function applyPolicyPatch(
  state: AutograbState,
  patch: GrabPolicyPatch,
  defaultCid: string
): AutograbResult {
  if (
    patch.mode === 'auto' &&
    state.policy.mode !== 'auto' &&
    defaultCid === '0'
  )
    return { ok: false, error: POLICY_FOLDER_ERROR }
  state.policy = { ...state.policy, ...patch }
  return { ok: true }
}

/**
 * 这部剧的转存目标解析：自己选的文件夹 > 所属分类的默认文件夹 > 剧集默认目录（defaultFolder，内含原转存目标兜底）；
 * "0" = 根目录。分类按最近一次日历里这部剧的分类（给 seriesId 时才看分类）。
 */
export function targetResolver(
  state: () => AutograbState,
  defaultFolder: () => { cid: string },
  calendar: () => readonly CalendarEpisode[]
): (
  setting: Pick<SeriesSetting, 'cid'> | undefined,
  seriesId?: number
) => string {
  return (setting, seriesId) => {
    const category = calendar().find(e => e.seriesId === seriesId)?.category
    const folder = category ? state().categoryFolders[category]?.cid : undefined
    return normalizeCid(setting?.cid || folder || defaultFolder().cid)
  }
}

/** 设 / 清某个分类的默认文件夹 */
export function applyCategoryFolder(
  state: AutograbState,
  category: SeriesCategory,
  cid: string,
  name: string
): void {
  if (cid) state.categoryFolders[category] = { cid, name: name || '根目录' }
  else delete state.categoryFolders[category]
}
