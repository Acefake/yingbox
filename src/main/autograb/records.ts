/**
 * 追更状态的纯操作：用日历结果更新每集记录、整理界面上的剧列表。
 */
import type { AutograbSeries } from '../../shared/contract/autograb'
import type { CalendarEpisode } from '../../shared/library/ipc'
import { confirmFirstOf, seriesModeOf } from './policy'
import { episodeKey, searchStart } from './schedule-rules'
import type { AutograbState } from './state'

/**
 * 日历 → 记录：本地有文件的集记为已入库；追更中的剧（实际方式不是「不追」，没设过的剧按全局方式）
 * 已播出、本地没有的正片集（不含第 0 季）建一条等待记录。
 * 已有记录不重建（每集一条，幂等）。返回是否有改动。
 *
 * 撤销过的集：媒体库刷新前日历里还挂着被删的那个文件，文件名对得上就仍当缺集；
 * 日历里换成了别的文件才算入库，文件消失后清掉这个标记。
 */
export function applyCalendar(
  state: AutograbState,
  episodes: CalendarEpisode[],
  today: string
): boolean {
  let changed = false
  for (const ep of episodes) {
    const key = episodeKey(ep.seriesId, ep.season, ep.episode)
    const record = state.episodes[key]
    if (record?.revertedName) {
      const stale =
        ep.fileId !== null && baseName(ep.filePath) === record.revertedName
      if (stale) continue
      record.revertedName = null
      changed = true
    }
    if (ep.fileId !== null) {
      if (record && record.status !== 'done') {
        record.status = 'done'
        record.nextTry = null
        record.error = null
        changed = true
      }
      continue
    }
    if (record || seriesModeOf(state, ep.seriesId) === 'off') continue
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
      savedFileId: null,
      savedSize: null,
      savedFrom: null,
      banned: [],
      revertedName: null,
    }
    changed = true
  }
  return changed
}

/** 路径的最后一段（日历的 filePath 可能是本机路径或网盘路径） */
function baseName(path: string | null): string {
  return (path ?? '').split(/[\\/]/).pop() ?? ''
}

/** 每部剧今天之后最近的一个播出日（日历里没有的剧不在表里） */
export function nextAirDates(
  episodes: CalendarEpisode[],
  today: string
): Map<number, string> {
  const next = new Map<number, string>()
  for (const ep of episodes) {
    if (ep.season === 0 || ep.airDate <= today) continue
    const known = next.get(ep.seriesId)
    if (known === undefined || ep.airDate < known)
      next.set(ep.seriesId, ep.airDate)
  }
  return next
}

/** 界面上的剧列表：最近日历里出现的剧 + 设过追更的剧；实际在追的排前面，再按剧名 */
export function seriesList(
  state: AutograbState,
  airing: Map<number, string>,
  nextAir: Map<number, string> = new Map()
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
        title: airing.get(id) || setting?.title || `#${id}`,
        mode: setting?.mode ?? 'inherit',
        effectiveMode: seriesModeOf(state, id),
        confirmFirst: confirmFirstOf(state, setting),
        cid: setting?.cid ?? '',
        cidName: setting?.cidName ?? '',
        confirmed: setting?.confirmed ?? 0,
        prefs: setting?.prefs ?? {},
        nextAirDate: nextAir.get(id) ?? null,
      }
    })
    .sort(
      (a, b) =>
        Number(b.effectiveMode !== 'off') - Number(a.effectiveMode !== 'off') ||
        a.title.localeCompare(b.title, 'zh')
    )
}
