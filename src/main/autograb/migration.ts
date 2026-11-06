/** 将片库条目身份迁移为独立追剧任务，保留仍在追的转存状态。 */
import { effectiveMode } from '../../shared/contract/grab-policy'
import { episodeKey } from './schedule-rules'
import { mergeEpisodeRecords, mergeSetting } from './reconcile'
import {
  type AutograbState,
  type SeriesSetting,
  emptyState,
  parseState,
} from './state'

/** 迁移时只读关联条目，查不到时保留任务供重新确认。 */
export async function migrateAutograb(
  raw: unknown,
  now: number,
  lookup: (id: number) => Promise<Partial<SeriesSetting> | null>
): Promise<AutograbState> {
  const state = raw ? parseState(raw, now) : emptyState(now)
  if (state.version === 2) return state
  const pending = new Set(state.backfill ?? [])
  const previousMax = Math.max(
    0,
    ...Object.keys(state.series).map(Number),
    ...Object.values(state.episodes).map(r => r.seriesId)
  )
  for (const id of pending)
    state.series[String(id)] ??= {
      title: '',
      mode: state.policy.mode === 'off' ? 'confirm' : 'inherit',
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
    }
  const byTmdb = new Map<string, number>()
  const remap = new Map<number, number>()
  for (const [key, setting] of Object.entries(state.series)) {
    const id = Number(key)
    if (effectiveMode(setting.mode, state.policy) === 'off') {
      delete state.series[key]
      continue
    }
    const meta = await lookup(id).catch(() => null)
    if (meta?.tmdbId && (!setting.tmdbId || setting.tmdbId === meta.tmdbId)) {
      Object.assign(
        setting,
        Object.fromEntries(
          Object.entries(meta).filter(([, value]) => value !== undefined)
        )
      )
      setting.libraryItemId = id
    } else delete setting.libraryItemId
    const prior = setting.tmdbId ? byTmdb.get(setting.tmdbId) : undefined
    if (prior !== undefined) {
      state.series[String(prior)] = mergeSetting(
        setting,
        state.series[String(prior)]
      )
      remap.set(id, prior)
      delete state.series[key]
    } else if (setting.tmdbId) byTmdb.set(setting.tmdbId, id)
  }
  for (const [key, record] of Object.entries(state.episodes)) {
    const id = remap.get(record.seriesId) ?? record.seriesId
    if (!state.series[String(id)]) {
      delete state.episodes[key]
      continue
    }
    if (id === record.seriesId) continue
    const target = episodeKey(id, record.season, record.episode)
    const prior = state.episodes[target]
    state.episodes[target] = {
      ...mergeEpisodeRecords(prior, record),
      seriesId: id,
      key: target,
    }
    delete state.episodes[key]
  }
  state.backfill = [
    ...new Set([...pending].map(id => remap.get(id) ?? id)),
  ].filter(id => !!state.series[String(id)])
  state.nextSeriesId =
    Math.max(
      previousMax,
      ...Object.keys(state.series).map(Number),
      ...Object.values(state.episodes).map(r => r.seriesId)
    ) + 1
  state.version = 2
  return state
}
