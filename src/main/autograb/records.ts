/**
 * 追更状态的纯操作：用日历结果更新每集记录、整理界面上的剧列表。
 */
import type { AutograbSeries } from '../../shared/contract/autograb'
import type { CalendarEpisode } from '../../shared/library/ipc'
import { episodeKey, searchStart } from './schedule-rules'
import type { AutograbState } from './state'

/**
 * 日历 → 记录：本地有文件的集记为已入库；追更中的剧已播出、本地没有的正片集（不含第 0 季）建一条等待记录。
 * 已有记录不重建（每集一条，幂等）。返回是否有改动。
 */
export function applyCalendar(
  state: AutograbState,
  episodes: CalendarEpisode[],
  today: string
): boolean {
  let changed = false
  for (const ep of episodes) {
    const setting = state.series[String(ep.seriesId)]
    const key = episodeKey(ep.seriesId, ep.season, ep.episode)
    const record = state.episodes[key]
    if (ep.fileId !== null) {
      if (record && record.status !== 'done') {
        record.status = 'done'
        record.nextTry = null
        record.error = null
        changed = true
      }
      continue
    }
    if (record || !setting || setting.mode === 'off') continue
    if (ep.airDate > today || ep.season === 0) continue
    state.episodes[key] = {
      key,
      seriesId: ep.seriesId,
      seriesTitle: ep.seriesTitle,
      season: ep.season,
      episode: ep.episode,
      airDate: ep.airDate,
      status: 'waiting',
      attempts: 0,
      nextTry: searchStart(ep.airDate),
      candidates: [],
      error: null,
      savedAt: null,
      savedName: null,
      savedCid: null,
      notified: false,
    }
    changed = true
  }
  return changed
}

/** 界面上的剧列表：最近日历里出现的剧 + 设过追更的剧；在追的排前面，再按剧名 */
export function seriesList(
  state: AutograbState,
  airing: Map<number, string>
): AutograbSeries[] {
  const ids = new Set<number>([
    ...airing.keys(),
    ...Object.keys(state.series).map(Number),
  ])
  return [...ids]
    .map(id => {
      const setting = state.series[String(id)]
      return {
        seriesId: id,
        title: airing.get(id) ?? setting?.title ?? `#${id}`,
        mode: setting?.mode ?? 'off',
        cid: setting?.cid ?? '',
        cidName: setting?.cidName ?? '',
        confirmed: setting?.confirmed ?? 0,
      }
    })
    .sort(
      (a, b) =>
        Number(b.mode !== 'off') - Number(a.mode !== 'off') ||
        a.title.localeCompare(b.title, 'zh')
    )
}
