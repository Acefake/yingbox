/**
 * 媒体库的「继续播放」记录从片库观看进度生成，并进播放器的继续播放列表（mergeContinue，后写胜出）。
 *
 * 片库是进度的唯一来源：别的设备（经片库服务同步）看到哪儿，这里也接着哪儿；记录里的播放列表按本机路径重建。
 * 每部作品取最近的一条进度：
 * - 电影没看完 → 从那个位置继续；看完了 → 不列；
 * - 剧集那一集没看完 → 从那一集的位置继续；看完了 → 指向下一集（本季后面的，或后面季的第一集），没有就不列。
 * 应用启动、进入媒体库、同步拉下新进度时各补一次。
 */
import type {
  LibraryItemNode,
  RecentProgress,
} from '../../../../../shared/library/ipc'
import type { ContinueSection } from '@/features/player'
import { reachedWatched } from '../../../../../shared/library/watch-progress'
import {
  type ContinueRecord,
  mergeContinue,
  replaceLibraryContinue,
} from '@/features/player'

import { libraryBridge } from '../api/bridge'
import { sortedSeasons } from '../detail/detail-rules'
import { sectionOf } from '../state/library-section'
import { loadProgress } from './progress-cache'
import {
  type PlayRequest,
  continueMetaOf,
  episodePlayRequest,
  moviePlayRequest,
  playableEpisodes,
  playerPlaylist,
} from '../detail/playback'

/** 最多补多少部（与继续播放的总上限一致）。 */
export const HYDRATE_LIMIT = 40
/** 看完后又重新开始、播了不到这么多秒的，仍按看完处理（指向下一集）。 */
const REWATCH_MIN = 10

/** 这条进度算不算看完了这一集 / 这部电影。 */
export function progressDone(p: RecentProgress): boolean {
  return (
    reachedWatched(p.position, p.duration) ||
    (p.watched && p.position < REWATCH_MIN)
  )
}

/** 一集之后的下一集（本季后面的，或后面季的第一集）。 */
function nextEpisode(
  series: LibraryItemNode,
  season: LibraryItemNode,
  episode: LibraryItemNode
): PlayRequest | null {
  const list = playableEpisodes(season)
  const after = list[list.findIndex(ep => ep.id === episode.id) + 1]
  if (after) return episodePlayRequest(series, season, after)
  const seasons = sortedSeasons(series)
  for (const later of seasons.slice(
    seasons.findIndex(s => s.id === season.id) + 1
  )) {
    if (later.seasonNumber === 0) continue
    const first = playableEpisodes(later)[0]
    if (first) return episodePlayRequest(series, later, first)
  }
  return null
}

/** 剧里某一集与它所在的季（集挂在季下，或绝对集数直接挂在剧下）。 */
function locate(
  series: LibraryItemNode,
  itemId: number
): { season: LibraryItemNode; episode: LibraryItemNode } | null {
  for (const parent of [...series.children, series]) {
    const episode = parent.children.find(c => c.id === itemId)
    if (episode?.type === 'episode') return { season: parent, episode }
  }
  return null
}

/**
 * 由作品详情树与它最近的一条进度生成继续播放记录；不该列的返回 null。
 * @param section 作品所在媒体库的分区（启动时媒体库列表可能还没读进界面状态，由调用方按库给）
 */
export function continueRecordFrom(
  node: LibraryItemNode,
  p: RecentProgress,
  section?: ContinueSection
): ContinueRecord | null {
  const done = progressDone(p)
  let request: PlayRequest | null = null
  let nextUp = false
  if (node.type === 'movie') {
    request = done ? null : moviePlayRequest(node)
    const at = request?.refs.findIndex(r => r.fileId === p.fileId) ?? -1
    if (request && at > 0) request = { ...request, index: at }
  } else {
    const found = locate(node, p.itemId)
    if (found && done) {
      request = nextEpisode(node, found.season, found.episode)
      nextUp = true
    } else if (found)
      request = episodePlayRequest(node, found.season, found.episode)
  }
  if (!request) return null
  const meta = {
    ...continueMetaOf(node),
    ...(section ? { section } : {}),
    ...(request.partial ? { partial: true } : {}),
  }
  const playlist = playerPlaylist(request)
  const current = playlist[request.index]
  return {
    ...meta,
    id: `${meta.section}:${meta.key}`,
    replay: {
      ...(current.url ? { url: current.url } : { filePath: current.filePath }),
      playlist,
      index: request.index,
    },
    episode: playlist.length > 1 ? current.name : undefined,
    progress: nextUp ? 0 : p.position,
    duration: nextUp ? 0 : p.duration,
    nextUp,
    updatedAt: p.updatedAt,
  }
}

let running: Promise<void> | null = null
const revisions = new Map<number, number>()
let revisionCounter = 0

/** 从片库补一次继续播放（同一时刻只跑一次）。 */
export function hydrateContinue(): Promise<void> {
  running ??= (async () => {
    const bridge = libraryBridge()
    if (!bridge) return
    const snapshotRevision = revisionCounter
    const [recent, libraries] = await Promise.all([
      bridge.progress.recent(HYDRATE_LIMIT),
      bridge.listLibraries(),
    ])
    const sections = new Map(libraries.map(lib => [lib.id, lib]))
    // 这些作品的进度也读进缓存：从继续播放打开后连播的下一集同样从片库记的位置开始
    const [nodes] = await Promise.all([
      Promise.all(recent.map(p => bridge.getItem(p.rootId).catch(() => null))),
      loadProgress(recent.map(p => p.rootId)),
    ])
    recent.forEach((p, i) => {
      const node = nodes[i]
      if ((revisions.get(p.rootId) ?? 0) > snapshotRevision) return
      const record = node
        ? continueRecordFrom(
            node,
            p,
            sections.has(node.libraryId)
              ? sectionOf(sections.get(node.libraryId)!, node.type)
              : undefined
          )
        : null
      if (node && sections.get(node.libraryId)?.source === 'jav') {
        if (record) mergeContinue([record])
      } else if (node)
        replaceLibraryContinue(
          p.rootId,
          node.type === 'movie' ? 'movie' : 'tv',
          record
        )
    })
  })()
    .catch(error => console.warn('[library-progress] 补继续播放失败', error))
    .finally(() => (running = null))
  return running
}

/** 作品类型变化后立即重建继续播放记录。 */
export async function refreshContinueForItem(rootId: number): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) return
  const revision = ++revisionCounter
  revisions.set(rootId, revision)
  const [node, recent] = await Promise.all([
    bridge.getItem(rootId),
    bridge.progress.recent(HYDRATE_LIMIT),
  ])
  const progress = recent.find(p => p.rootId === rootId)
  if ((revisions.get(rootId) ?? 0) !== revision || !node) return
  replaceLibraryContinue(
    rootId,
    node.type === 'movie' ? 'movie' : 'tv',
    progress ? continueRecordFrom(node, progress) : null
  )
}
