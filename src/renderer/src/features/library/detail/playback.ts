/**
 * 从条目详情树得到播放列表，交给 openMediaPlayer（应用内播放弹窗或 mpv）：
 * 桌面端给本地文件路径，网页端给片库服务的 Range 流地址（/media/files/<id>）。
 */
import { isAnimeEntry } from '../../../../../shared/anime4k'
import type { VideoProbe } from '../../../../../shared/video-range'
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import {
  type ContinueMeta,
  type PlayerSourceItem,
  openMediaPlayer,
} from '@/features/player'

import type { WatchlistMeta } from '@/features/watchlist'
import { serverFileUrl } from '@/services/library-server'

import { usesLibraryServer } from '../api/bridge'
import { itemImage } from '../api/images'
import { sectionOf } from '../state/library-section'
import { findLibrary } from '../state/use-libraries'
import { baseName, episodeCode } from '../shared/format'
import { seasonOrder, sortedSeasons } from './detail-rules'

/** 节点自身的视频文件（按路径排序：分段 / 多版本按文件名顺序）。 */
export function videoFileEntries(node: LibraryItemNode): LibraryItemFile[] {
  return node.files
    .filter(file => file.kind === 'video')
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

/** 节点自身的视频文件路径（顺序同 videoFileEntries）。 */
export function videoFiles(node: LibraryItemNode): string[] {
  return videoFileEntries(node).map(file => file.path)
}

/** 一季里有文件的集，按集号排序。 */
export function playableEpisodes(season: LibraryItemNode): LibraryItemNode[] {
  return season.children
    .filter(ep => ep.type === 'episode' && videoFiles(ep).length > 0)
    .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
}

/** 集的展示名：“S01E05 · 标题”。 */
export function episodeLabel(episode: LibraryItemNode): string {
  const code = episodeCode(episode.seasonNumber, episode.episodeNumber)
  return [code, episode.title].filter(Boolean).join(' · ')
}

/** 播放请求：第一个文件 + 连播列表；fileIds 与 playlist 一一对应（网页端按 id 取流）。 */
export interface PlayRequest {
  title: string
  playlist: PlayerSourceItem[]
  fileIds: number[]
  index: number
  /** 所属条目（电影本身 / 剧集的剧），记「继续播放」用 */
  item: LibraryItemNode
  /** 只是作品的一部分（后面还有季）：播完不算整部看完 */
  partial?: boolean
  /** 起始文件的动态范围（杜比视界 P5 据此改走 mpv）；没探测过时缺省 */
  video?: VideoProbe | null
}

/** 电影：全部视频文件按顺序连播（分段电影 CD1 / CD2）。 */
export function moviePlayRequest(node: LibraryItemNode): PlayRequest | null {
  const files = videoFileEntries(node)
  if (!files.length) return null
  return {
    title: node.title,
    playlist: files.map(file => ({
      filePath: file.path,
      name: baseName(file.path),
    })),
    fileIds: files.map(file => file.id),
    index: 0,
    item: node,
    ...(files[0].video ? { video: files[0].video } : {}),
  }
}

/**
 * 这一季播完后剧集是否还没看完：后面还有有文件的正片季。
 * 特别篇（第 0 季）排在最后，但只要有正片季就不算整部的结尾。
 */
export function hasLaterSeason(
  series: LibraryItemNode,
  season: LibraryItemNode
): boolean {
  return sortedSeasons(series).some(
    other =>
      other.id !== season.id &&
      other.seasonNumber !== 0 &&
      (season.seasonNumber === 0 || seasonOrder(other) > seasonOrder(season)) &&
      playableEpisodes(other).length > 0
  )
}

/** 剧集：从某一集开始，按本季顺序连播；后面还有季时标 partial。 */
export function episodePlayRequest(
  series: LibraryItemNode,
  season: LibraryItemNode,
  episode: LibraryItemNode
): PlayRequest | null {
  const episodes = playableEpisodes(season)
  const index = episodes.findIndex(ep => ep.id === episode.id)
  if (index < 0) return null
  const firsts = episodes.map(ep => videoFileEntries(ep)[0])
  return {
    title: `${series.title} ${episodeLabel(episode)}`,
    playlist: episodes.map((ep, i) => ({
      filePath: firsts[i].path,
      name: episodeLabel(ep),
    })),
    fileIds: firsts.map(file => file.id),
    index,
    item: series,
    ...(hasLaterSeason(series, season) ? { partial: true } : {}),
    ...(firsts[index].video ? { video: firsts[index].video } : {}),
  }
}

/** 条目的主播放：电影连播全部文件；剧集从排序后第一个有文件的季的第一集开始。没有文件返回 null。 */
export function primaryPlayRequest(node: LibraryItemNode): PlayRequest | null {
  if (node.type === 'movie') return moviePlayRequest(node)
  for (const season of sortedSeasons(node)) {
    const first = playableEpisodes(season)[0]
    if (first) return episodePlayRequest(node, season, first)
  }
  return null
}

/** 「继续播放」登记：分区按条目所在媒体库，封面优先横版背景图。 */
export function continueMetaOf(item: LibraryItemNode): ContinueMeta {
  const lib = findLibrary(item.libraryId)
  return {
    section: lib ? sectionOf(lib) : item.type === 'series' ? 'tv' : 'movie',
    key: String(item.id),
    title: item.title,
    cover:
      itemImage(item.backdrop, 780) ?? itemImage(item.poster, 780) ?? undefined,
    detail: { itemId: item.id },
  }
}

/** 「想看」登记：分区、键与继续播放相同（整部看完时据此移出清单），另带竖版海报。 */
export function watchlistMetaOf(item: LibraryItemNode): WatchlistMeta {
  const { section, key, title, cover, detail } = continueMetaOf(item)
  const poster = itemImage(item.poster, 300) ?? undefined
  return { section, key, title, poster, cover, detail }
}

/** 打开播放器；没有可用播放器返回 false。 */
export async function play(
  request: PlayRequest,
  poster?: string
): Promise<boolean> {
  const continueAs = {
    ...continueMetaOf(request.item),
    ...(request.partial ? { partial: true } : {}),
  }
  const anime = isAnimeEntry({ genres: request.item.genres })
  if (usesLibraryServer()) {
    const playlist = request.playlist.map((item, i) => ({
      url: serverFileUrl(request.fileIds[i]),
      name: item.name,
    }))
    return openMediaPlayer({
      url: playlist[request.index].url,
      title: request.title,
      poster,
      playlist,
      index: request.index,
      continueAs,
      anime,
    })
  }
  const first = request.playlist[request.index]
  return openMediaPlayer({
    filePath: first.filePath,
    title: request.title,
    poster,
    playlist: request.playlist,
    index: request.index,
    continueAs,
    anime,
    ...(request.video ? { video: request.video } : {}),
  })
}
