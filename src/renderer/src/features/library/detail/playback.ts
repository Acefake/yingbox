/**
 * 从条目详情树得到播放列表，交给现有播放能力（openMediaPlayer：内置播放器或 mpv）。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { type PlayerSourceItem, openMediaPlayer } from '@/features/player'

import { baseName, episodeCode } from '../shared/format'

/** 节点自身的视频文件（按路径排序：分段 / 多版本按文件名顺序）。 */
export function videoFiles(node: LibraryItemNode): string[] {
  return node.files
    .filter(file => file.kind === 'video')
    .map(file => file.path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
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

/** 播放请求：第一个文件 + 连播列表。 */
export interface PlayRequest {
  title: string
  playlist: PlayerSourceItem[]
  index: number
}

/** 电影：全部视频文件按顺序连播（分段电影 CD1 / CD2）。 */
export function moviePlayRequest(node: LibraryItemNode): PlayRequest | null {
  const files = videoFiles(node)
  if (!files.length) return null
  return {
    title: node.title,
    playlist: files.map(path => ({ filePath: path, name: baseName(path) })),
    index: 0,
  }
}

/** 剧集：从某一集开始，按本季顺序连播。 */
export function episodePlayRequest(
  series: LibraryItemNode,
  season: LibraryItemNode,
  episode: LibraryItemNode
): PlayRequest | null {
  const episodes = playableEpisodes(season)
  const index = episodes.findIndex(ep => ep.id === episode.id)
  if (index < 0) return null
  return {
    title: `${series.title} ${episodeLabel(episode)}`,
    playlist: episodes.map(ep => ({
      filePath: videoFiles(ep)[0],
      name: episodeLabel(ep),
    })),
    index,
  }
}

/** 打开播放器；没有可用播放器（网页版）返回 false。 */
export async function play(
  request: PlayRequest,
  poster?: string
): Promise<boolean> {
  const first = request.playlist[request.index]
  return openMediaPlayer({
    filePath: first.filePath,
    title: request.title,
    poster,
    playlist: request.playlist,
    index: request.index,
  })
}
