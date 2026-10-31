/**
 * 从条目详情树得到播放列表，交给 openMediaPlayer（应用内播放弹窗或 mpv）：
 * 桌面端给本地文件路径，网页端给片库服务的 Range 流地址（/media/files/<id>）。
 * 每一项带媒体库标记（条目 id + 文件 id），进度只记进片库；开播前先读出这部作品的进度，从上次的位置接着播。
 */
import type { VideoProbe } from '../../../../../shared/video-range'
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import { autograbAvailable } from '@/features/autograb'
import {
  type ContinueMeta,
  type EndHint,
  type LibraryRef,
  type PlayerSourceItem,
  openMediaPlayer,
} from '@/features/player'

import type { WatchlistMeta } from '@/features/watchlist'
import { serverFileUrl } from '@/services/library-server'

import { usesLibraryServer } from '../api/bridge'
import { itemImage } from '../api/images'
import { sectionOf } from '../state/library-section'
import { findLibrary } from '../state/use-libraries'
import { prepareProgress, resumeAt } from '../progress/progress-cache'
import { baseName, episodeCode } from '../shared/format'
import { seasonOrder, sortedSeasons } from './detail-rules'
import { pickVersion } from './version-rules'

/**
 * 节点要播放的视频文件：有版本时是选中版本（缺省最好的那个）的文件，按分段顺序；
 * 没有版本信息时是全部视频文件按路径排序。
 * @param prefer 用户选的版本或来源（见 version-rules.ts）
 */
export function videoFileEntries(
  node: LibraryItemNode,
  prefer?: string | null
): LibraryItemFile[] {
  const all = node.files
    .filter(file => file.kind === 'video')
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  const version = pickVersion(node, prefer)
  if (!version) return all
  const byId = new Map(all.map(file => [file.id, file]))
  return version.fileIds.flatMap(id => byId.get(id) ?? [])
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
  return (
    [code, episode.title].filter(Boolean).join(' · ') ||
    baseName(videoFiles(episode)[0] ?? '')
  )
}

/** 播放请求：第一个文件 + 连播列表；fileIds 与 playlist 一一对应（网页端按 id 取流）。 */
export interface PlayRequest {
  title: string
  playlist: PlayerSourceItem[]
  fileIds: number[]
  /** 每一项的媒体库标记（与 playlist 一一对应） */
  refs: LibraryRef[]
  index: number
  /** 所属条目（电影本身 / 剧集的剧），记「继续播放」用 */
  item: LibraryItemNode
  /** 只是作品的一部分（后面还有季）：播完不算整部看完 */
  partial?: boolean
  /** 起始文件的动态范围（杜比视界 P5 据此改走 mpv）；没探测过时缺省 */
  video?: VideoProbe | null
  /** 从起始文件的第几秒开始播（按画面搜点了某个视频画面）；缺省按观看进度续播 / 从头 */
  startAt?: number
  /** 剧集播完本地最后一集时的提示 */
  endHint?: EndHint
}

/** 电影：选中版本的文件按顺序连播（分段电影 CD1 / CD2）。 */
export function moviePlayRequest(
  node: LibraryItemNode,
  prefer?: string | null
): PlayRequest | null {
  const files = videoFileEntries(node, prefer)
  if (!files.length) return null
  return {
    title: node.title,
    playlist: files.map(file => ({
      filePath: file.path,
      name: baseName(file.path),
      ...(file.video ? { video: file.video } : {}),
    })),
    fileIds: files.map(file => file.id),
    refs: files.map(file => ({ itemId: node.id, fileId: file.id })),
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

/**
 * 本季播完本地最后一集、后面也没有季时的提示：本季后面有没文件的集就点名那一集，否则说播完了本地的最后一集；
 * 桌面端给「去追更」（追剧日历页的追更面板）。
 */
export function seasonEndHint(
  season: LibraryItemNode,
  episodes: readonly LibraryItemNode[]
): EndHint {
  const last = episodes.at(-1)?.episodeNumber ?? 0
  const missing = season.children
    .filter(
      ep =>
        ep.type === 'episode' &&
        (ep.episodeNumber ?? 0) > last &&
        videoFiles(ep).length === 0
    )
    .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0]
  const text = missing
    ? `本地还没有 ${episodeCode(missing.seasonNumber, missing.episodeNumber) || '下一集'} 的文件`
    : '已播完本地的最后一集'
  return autograbAvailable
    ? { text, action: { label: '去追更', to: '/calendar?autograb=1' } }
    : { text }
}

/** 剧集：从某一集开始，按本季顺序连播（每集取选中来源的版本）；后面还有季时标 partial，否则带播完提示。 */
export function episodePlayRequest(
  series: LibraryItemNode,
  season: LibraryItemNode,
  episode: LibraryItemNode,
  prefer?: string | null
): PlayRequest | null {
  const episodes = playableEpisodes(season)
  const index = episodes.findIndex(ep => ep.id === episode.id)
  if (index < 0) return null
  const firsts = episodes.map(ep => videoFileEntries(ep, prefer)[0])
  return {
    title: `${series.title} ${episodeLabel(episode)}`,
    playlist: episodes.map((ep, i) => ({
      filePath: firsts[i].path,
      name: episodeLabel(ep),
      ...(firsts[i].video ? { video: firsts[i].video } : {}),
    })),
    fileIds: firsts.map(file => file.id),
    refs: episodes.map((ep, i) => ({ itemId: ep.id, fileId: firsts[i].id })),
    index,
    item: series,
    ...(hasLaterSeason(series, season)
      ? { partial: true }
      : { endHint: seasonEndHint(season, episodes) }),
    ...(firsts[index].video ? { video: firsts[index].video } : {}),
  }
}

/** 条目的主播放：电影连播选中版本的文件；剧集从排序后第一个有文件的季的第一集开始。没有文件返回 null。 */
export function primaryPlayRequest(
  node: LibraryItemNode,
  prefer?: string | null
): PlayRequest | null {
  if (node.type === 'movie') return moviePlayRequest(node, prefer)
  for (const season of sortedSeasons(node)) {
    const first = playableEpisodes(season)[0]
    if (first) return episodePlayRequest(node, season, first, prefer)
  }
  return null
}

/** 「继续播放」登记：分区按条目所在媒体库，封面优先横版背景图。 */
export function continueMetaOf(item: LibraryItemNode): ContinueMeta {
  const lib = findLibrary(item.libraryId)
  return {
    section: lib
      ? sectionOf(lib, item.type)
      : item.type === 'series'
        ? 'tv'
        : 'movie',
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

/** 交给播放器的播放列表：桌面端是文件路径，网页端是片库服务的流地址；每项带媒体库标记。 */
export function playerPlaylist(request: PlayRequest): PlayerSourceItem[] {
  return request.playlist.map((item, i) =>
    usesLibraryServer()
      ? {
          url: serverFileUrl(request.fileIds[i]),
          name: item.name,
          library: request.refs[i],
        }
      : { ...item, library: request.refs[i] }
  )
}

/** 打开播放器；没有可用播放器返回 false。从片库记的位置接着播（看完的从头）。 */
export async function play(
  request: PlayRequest,
  poster?: string
): Promise<boolean> {
  const continueAs = {
    ...continueMetaOf(request.item),
    ...(request.partial ? { partial: true } : {}),
  }
  await prepareProgress(request.item)
  const playlist = playerPlaylist(request)
  const first = playlist[request.index]
  // 按画面搜指定的时间点优先，其次续播进度
  const startAt = request.startAt ?? resumeAt(request.refs[request.index])
  return openMediaPlayer({
    ...(first.url ? { url: first.url } : { filePath: first.filePath }),
    title: request.title,
    poster,
    playlist,
    index: request.index,
    continueAs,
    ...(startAt !== undefined ? { startAt } : {}),
    ...(request.endHint ? { endHint: request.endHint } : {}),
    ...(!usesLibraryServer() && request.video ? { video: request.video } : {}),
  })
}
