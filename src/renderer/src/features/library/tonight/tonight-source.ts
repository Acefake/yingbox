/**
 * 「今晚看什么」的候选来源：媒体库里没看完的电影（已看完标记或进度到片尾的不算） + 继续播放里在看的剧（以及看了一半的电影）。
 *
 * - 只查 TMDB 来源的库（query.source = tmdb），继续播放只取 movie / tv 板块：番号库与私密板块不进候选；
 * - 时长 / 类型 / 简介只在详情里，先按评分抽一池（samplePool）再逐条 getItem，并发 6；
 * - 结果缓存 5 分钟，同一次打开里「换一批」不重复读库。
 */
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import {
  type ContinueRecord,
  continueRecords,
  getMediaProgress,
  isWatched,
} from '@/features/player'
import { serverFileUrl } from '@/services/library-server'

import { libraryBridge, usesLibraryServer } from '../api/bridge'
import { videoFileEntries } from '../detail/playback'
import { findLibrary } from '../state/use-libraries'
import {
  type TonightCandidate,
  type TonightProgress,
  type TonightWatch,
  movieCandidate,
  samplePool,
  seriesCandidate,
} from './tonight-rules'

/** 每次最多取多少部电影的详情 */
const POOL_SIZE = 160
/** 读详情的并发数 */
const CONCURRENCY = 6
/** 候选缓存时长 */
const CACHE_MS = 5 * 60_000

let cache: { at: number; list: TonightCandidate[] } | null = null

/** 继续播放记录 → 媒体库条目 id（detail 是 { itemId }） */
function itemIdOf(record: ContinueRecord): number | null {
  const detail = record.detail as { itemId?: unknown } | undefined
  const id = detail?.itemId ?? Number(record.key)
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

function progressOf(record: ContinueRecord): TonightProgress {
  return {
    id: record.id,
    progress: record.progress,
    duration: record.duration,
    ...(record.episode ? { episode: record.episode } : {}),
    ...(record.nextUp ? { nextUp: true } : {}),
  }
}

/**
 * 电影第一个视频文件的观看情况（桌面端按路径，网页端按流地址，与播放器的进度键一致）：
 * 已播秒数 + 是否在「已看完」集合里。
 */
function watchOf(node: LibraryItemNode): TonightWatch {
  const first = videoFileEntries(node)[0]
  if (!first) return { seconds: 0, finished: false }
  const key = usesLibraryServer() ? serverFileUrl(first.id) : first.path
  return { seconds: getMediaProgress(key), finished: isWatched(key) }
}

/** 并发受限地逐个处理 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      out[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return out
}

/** 番号库的条目（防御：继续播放的 movie 板块本来就不含番号库） */
const isPrivate = (node: LibraryItemNode): boolean =>
  findLibrary(node.libraryId)?.source === 'jav'

/** 读候选（5 分钟内复用；fresh 强制重读） */
export async function loadTonightCandidates(
  fresh = false
): Promise<TonightCandidate[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.list
  const bridge = libraryBridge()
  if (!bridge) return []

  const watching = new Map<number, ContinueRecord>()
  for (const record of continueRecords().value) {
    if (record.section !== 'movie' && record.section !== 'tv') continue
    const id = itemIdOf(record)
    if (id !== null && !watching.has(id)) watching.set(id, record)
  }

  const { items } = await bridge.query({
    source: 'tmdb',
    types: ['movie'],
    sort: 'rating',
    order: 'desc',
    limit: 1000,
  })
  const pool = samplePool(
    items.filter(item => !watching.has(item.id)).map(item => item.id),
    POOL_SIZE
  )
  const ids = [...watching.keys(), ...pool]
  const nodes = await mapLimit(ids, CONCURRENCY, id =>
    bridge.getItem(id).catch(() => null)
  )

  const list: TonightCandidate[] = []
  for (const node of nodes) {
    if (!node || isPrivate(node)) continue
    const record = watching.get(node.id)
    const candidate =
      node.type === 'series'
        ? record
          ? seriesCandidate(node, progressOf(record))
          : null
        : movieCandidate(node, watchOf(node), record && progressOf(record))
    if (candidate) list.push(candidate)
  }
  cache = { at: Date.now(), list }
  return list
}

/** 某条在看记录（播放时续播用） */
export function watchingRecord(id: string | undefined): ContinueRecord | null {
  if (!id) return null
  return continueRecords().value.find(r => r.id === id) ?? null
}
