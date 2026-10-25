/**
 * 洗版 · 一条记录要找什么：剧集用追更的认集规则（match-rules），电影用电影规则（movie-rules），
 * 都只收达到目标、比现在更清楚的文件。
 */
import { keywordsFor } from '../finder'
import {
  type EpisodeTarget,
  folderWorthOpening,
  matchFile,
} from '../match-rules'
import {
  matchMovieFile,
  movieFolderWorthOpening,
  movieKeywords,
} from '../movies/movie-rules'
import { isBetter, resolutionOf } from './quality-rules'
import type { ScanPlan } from './share-scan'
import type { UpgradeRecord } from './state'

/** 记录 → 查找计划 */
export function upgradePlan(record: UpgradeRecord, target: number): ScanPlan {
  const better = (resolution: number | null): boolean =>
    isBetter(record.resolution, target, resolution)
  if (record.kind === 'episode') {
    const episode: EpisodeTarget = {
      seriesTitle: record.title,
      season: record.season ?? 1,
      episode: record.episode ?? 0,
    }
    return {
      keywords: keywordsFor(episode),
      title: record.title,
      openFolder: name => folderWorthOpening(name, episode),
      match: (file, context) => {
        const m = matchFile(file, episode, context)
        const resolution = resolutionOf(file.name)
        return m.ok && better(resolution)
          ? { score: m.score, reasons: m.reasons, resolution }
          : null
      },
    }
  }
  const movie = { title: record.title, originalTitle: '', year: record.year }
  return {
    keywords: movieKeywords(movie),
    title: record.title,
    openFolder: name => movieFolderWorthOpening(name, movie),
    match: (file, context) => {
      const m = matchMovieFile(file, movie, context, false)
      return m.ok && better(m.resolution) ? m : null
    },
  }
}
