/**
 * 从条目详情树得到播放列表，交给运行环境的播放能力：
 * 桌面端 openMediaPlayer（内置播放器窗口或 mpv），网页端页内 <video>（web-player.ts，片库服务的 Range 流）。
 */
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import { type PlayerSourceItem, openMediaPlayer } from '@/features/player'

import { usesLibraryServer } from '../api/bridge'
import { baseName, episodeCode } from '../shared/format'
import { openWebPlayer } from './web-player'

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
  const firsts = episodes.map(ep => videoFileEntries(ep)[0])
  return {
    title: `${series.title} ${episodeLabel(episode)}`,
    playlist: episodes.map((ep, i) => ({
      filePath: firsts[i].path,
      name: episodeLabel(ep),
    })),
    fileIds: firsts.map(file => file.id),
    index,
  }
}

/** 打开播放器；没有可用播放器返回 false。 */
export async function play(
  request: PlayRequest,
  poster?: string
): Promise<boolean> {
  if (usesLibraryServer())
    return openWebPlayer({
      title: request.title,
      poster,
      files: request.playlist.map((item, i) => ({
        fileId: request.fileIds[i],
        name: item.name ?? '',
      })),
      index: request.index,
    })
  const first = request.playlist[request.index]
  return openMediaPlayer({
    filePath: first.filePath,
    title: request.title,
    poster,
    playlist: request.playlist,
    index: request.index,
  })
}
