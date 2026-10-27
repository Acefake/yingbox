/**
 * 洗版 · 一条记录要找什么：剧集用追更的认集规则（match-rules），电影用电影规则（movie-rules），
 * 都只收比现在的文件更好的版本（shared/release/score.ts isBetterVersion：达到目标且分辨率更高，
 * 或同分辨率下按偏好算更好的杜比视界 / REMUX）。
 */
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
} from '../../../shared/contract/grab-prefs'
import {
  fileQuality,
  parseReleaseQuality,
} from '../../../shared/release/quality'
import { isBetterVersion } from '../../../shared/release/score'
import { keywordsFor } from '../finder'
import {
  type EpisodeTarget,
  type FileContext,
  type ShareFileLike,
  folderWorthOpening,
  matchFile,
} from '../match-rules'
import {
  matchMovieFile,
  movieFolderWorthOpening,
  movieKeywords,
} from '../movies/movie-rules'
import type { ScanPlan } from './share-scan'
import type { UpgradeRecord } from './state'

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * 记录 → 查找计划。
 * @param target 目标分辨率高度
 * @param prefs 这个种类的资源偏好
 */
export function upgradePlan(
  record: UpgradeRecord,
  target: number,
  prefs: GrabPrefs = DEFAULT_GRAB_PREFS
): ScanPlan {
  const current = parseReleaseQuality(baseName(record.filePath))
  const better = (file: ShareFileLike, context: FileContext): boolean =>
    isBetterVersion(
      current,
      fileQuality(file.name, context.folder, context.shareTitle),
      target,
      prefs
    )
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
        const m = matchFile(file, episode, context, prefs)
        return m.ok && better(file, context)
          ? { ...m, resolution: m.height }
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
      const m = matchMovieFile(file, movie, context, false, prefs)
      return m.ok && better(file, context) ? m : null
    },
  }
}
