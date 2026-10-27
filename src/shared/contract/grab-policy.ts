/**
 * 追更策略：电影、剧集各一份全局默认（方式 + 新剧先确认几集 + 资源偏好），每部剧 / 电影「跟随全局」或单独设。
 *
 * - 剧集：方式 不追 / 待确认 / 全自动；没单独设过的在播剧也按全局方式追。全自动前每部剧先手动确认
 *   `confirmFirst` 集（单独设过方式的老剧可能自带门槛，见追更状态的迁移）。
 * - 电影：只管加进追踪的电影，方式 待确认 / 全自动；`confirmFirst` 不用。
 * - 资源偏好见 ./grab-prefs.ts；单部覆盖与全局合并（mergePrefs）。
 *
 * 解析函数对任何输入都不抛错，认不出的字段用默认：同一套给契约边界和读状态文件用。
 */
import { DEFAULT_GRAB_PREFS, type GrabPrefs, prefsOf } from './grab-prefs'

/** 追更方式：不追 / 待确认 / 全自动 */
export const GRAB_MODES = ['off', 'confirm', 'auto'] as const
export type GrabMode = (typeof GRAB_MODES)[number]

/** 单部的方式：跟随全局，或单独设一种 */
export type GrabModeSetting = 'inherit' | GrabMode

/** 「新剧先确认」的选项：不用 / 1 集 / 3 集 */
export const CONFIRM_FIRST_OPTIONS = [0, 1, 3] as const

/** 一种媒体的全局策略 */
export interface GrabPolicy {
  /** 没单独设的剧 / 电影用这个方式（电影只有 confirm / auto） */
  mode: GrabMode
  /** 全自动前每部新剧先手动确认几集（0–10）；电影不用 */
  confirmFirst: number
  prefs: GrabPrefs
}

/** 改策略：只写要改的；prefs 整份替换 */
export interface GrabPolicyPatch {
  mode?: GrabMode
  confirmFirst?: number
  prefs?: GrabPrefs
}

/** 剧集的默认策略：不追、新剧先确认 1 集、默认偏好 */
export const DEFAULT_TV_POLICY: GrabPolicy = {
  mode: 'off',
  confirmFirst: 1,
  prefs: DEFAULT_GRAB_PREFS,
}

/** 电影的默认策略：待确认、默认偏好 */
export const DEFAULT_MOVIE_POLICY: GrabPolicy = {
  mode: 'confirm',
  confirmFirst: 0,
  prefs: DEFAULT_GRAB_PREFS,
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** 确认集数：0–10 的整数；其它为 undefined */
export function confirmFirstOf(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined
  return raw >= 0 && raw <= 10 ? raw : undefined
}

/** 方式：电影没有「不追」 */
function modeOf(raw: unknown, kind: 'tv' | 'movie'): GrabMode | undefined {
  if (!GRAB_MODES.includes(raw as GrabMode)) return undefined
  if (kind === 'movie' && raw === 'off') return undefined
  return raw as GrabMode
}

/** 任意值 → 策略补丁（只留认得出的字段） */
export function policyPatchOf(
  raw: unknown,
  kind: 'tv' | 'movie'
): GrabPolicyPatch {
  if (!isObj(raw)) return {}
  const patch: GrabPolicyPatch = {}
  const mode = modeOf(raw.mode, kind)
  if (mode) patch.mode = mode
  const confirm = confirmFirstOf(raw.confirmFirst)
  if (confirm !== undefined) patch.confirmFirst = confirm
  if (isObj(raw.prefs)) patch.prefs = prefsOf(raw.prefs)
  return patch
}

/** 任意值 → 完整策略（缺的字段用这种媒体的默认） */
export function policyOf(raw: unknown, kind: 'tv' | 'movie'): GrabPolicy {
  const base = kind === 'tv' ? DEFAULT_TV_POLICY : DEFAULT_MOVIE_POLICY
  return {
    ...base,
    prefs: { ...base.prefs },
    ...policyPatchOf(raw, kind),
  }
}

/** 单部的方式设置 → 实际生效的方式（跟随全局 / 没设过时用全局） */
export function effectiveMode(
  setting: GrabModeSetting | undefined,
  policy: Pick<GrabPolicy, 'mode'>
): GrabMode {
  return !setting || setting === 'inherit' ? policy.mode : setting
}
