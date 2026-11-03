/**
 * 追更在默认目录下建的子文件夹名：取整理模板的第一段，填和整理同一套值（TMDB 片名 / 年份 / id），
 * 这样整理时文件夹不会再被改名、文件也不会被挪去别的新文件夹（ADR-0029）。
 */
import type { LibraryItemNode } from '../../shared/library/ipc'
import { templateFolder } from '../../shared/library/writer'

/**
 * 剧的文件夹名。
 * @param item 片库里这部剧（拿 TMDB 元数据）；不在库里为 null，退回剧名
 */
export function seriesFolderName(
  template: string,
  item: LibraryItemNode | null,
  title: string
): string | null {
  const meta = item?.metadata?.level === 'title' ? item.metadata : null
  const name = meta?.title ?? item?.title ?? title
  return templateFolder(template, {
    title: name,
    series: name,
    originalTitle: meta?.originalTitle ?? item?.originalTitle ?? name,
    year: meta?.year ?? item?.year,
    tmdbId: meta?.externalIds.tmdb ?? item?.providerIds.tmdb,
    imdbId: meta?.externalIds.imdb,
    season: 1,
    episode: 1,
    ext: 'mkv',
  })
}

/** 电影的文件夹名。 */
export function movieFolderName(
  template: string,
  movie: {
    title: string
    originalTitle?: string
    year: number | null
    tmdbId: number
  }
): string | null {
  return templateFolder(template, {
    title: movie.title,
    originalTitle: movie.originalTitle || movie.title,
    year: movie.year,
    tmdbId: movie.tmdbId,
    ext: 'mkv',
  })
}
