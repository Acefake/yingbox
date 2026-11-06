/** 将独立追剧任务的分集投影到日历，不把任务句柄当成媒体库条目 id。 */
import type { CalendarEpisode } from '../../../../shared/library/ipc'
import { sameTitle } from '@/services/online-series-links'
import {
  type CalendarEntry,
  type ContinueLike,
  type ProgressLike,
  libraryEntries,
} from './calendar-rules'

/** 媒体库已经展示的相同 TMDB 分集只显示一次。 */
export function trackingEntries(
  episodes: readonly CalendarEpisode[],
  library: readonly CalendarEpisode[],
  today: string,
  records: readonly ContinueLike[],
  progress: (ep: CalendarEpisode) => ProgressLike | null
): CalendarEntry[] {
  const identity = (ep: CalendarEpisode): string =>
    `${ep.tmdbId}:${ep.season}:${ep.episode}`
  const occupied = new Set(library.filter(ep => ep.tmdbId).map(identity))
  const rows = libraryEntries(episodes, today, [], progress)
  return rows.flatMap(({ library: task, ...entry }, index) => {
    const ep = episodes[index]
    if (ep.tmdbId && occupied.has(identity(ep))) return []
    const online = records.find(
      r => r.section === 'online' && sameTitle(r.title, ep.seriesTitle)
    )
    const seen = online
      ? (online.replay.index ?? 0) + (online.nextUp ? 0 : 1)
      : 0
    const watched = ep.season === 1 && ep.episode <= seen
    return [
      {
        ...entry,
        id: `tracking:${entry.id}`,
        source: 'tracking' as const,
        ...(watched ? { status: 'watched' as const, newCount: 0 } : {}),
        tracking: {
          seriesId: task!.seriesId,
          season: task!.season,
          episode: task!.episode,
        },
      },
    ]
  })
}
