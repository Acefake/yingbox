/**
 * 详情、选源会话与播放地址（ADR-0030）：view.detail、view.sourcesStart / view.sources、view.resolve。
 */
import { randomUUID } from 'node:crypto'

import type { DoubanMetadata } from '../../shared/douban/detail'
import type { DoubanItem } from '../../shared/douban/item'
import { streamProxyPath } from '../../shared/engine-http'
import { formatRating } from '../../shared/library/rating'
import { isThumbSource } from '../../shared/media-url'
import { splitStreamHeaders } from '../../shared/net/stream-headers'
import {
  type PlaySourceDeps,
  isDirectMediaUrl,
  resolvePlaySource,
} from '../../shared/online/play-source'
import { normalizeTitle } from '../../shared/online/sources'
import type { EpisodeGroup } from '../../shared/online/types'
import type {
  ViewDetail,
  ViewEpisode,
  ViewPlayable,
  ViewSources,
} from '../../shared/view/detail'
import { thumbPath } from './home'
import { type SourceDeps, searchSources, sourceSites } from './sources'

const thumbOr = (src: string, width: 300 | 480 | 780): string | null =>
  src && isThumbSource(src) ? thumbPath(src, width) : null

/** 豆瓣条目地址（收藏按它比对，与桌面豆瓣卡一致） */
const doubanUrlOf = (id: string): string =>
  `https://movie.douban.com/subject/${id}/`

/** 豆瓣元数据 → 收藏用的豆瓣卡（与桌面收藏 media_favorites 同形状） */
export function favoriteItemOf(meta: DoubanMetadata): DoubanItem {
  return {
    title: meta.title,
    searchTitle: meta.title,
    original_title: meta.originalTitle,
    cover: meta.cover,
    coverSrc: meta.cover,
    ...(meta.backdrop ? { backdrop: meta.backdrop } : {}),
    rate: meta.rating ? meta.rating.value.toFixed(1) : '暂无',
    url: doubanUrlOf(meta.id),
    year: meta.year,
    type: meta.kind === 'tv' ? '剧集' : '电影',
    overview: meta.intro,
    kind: meta.kind,
  }
}

/** 豆瓣元数据 → 详情视图 */
export function viewDetail(
  meta: DoubanMetadata,
  favorite: boolean
): ViewDetail {
  return {
    id: meta.id,
    kind: meta.kind,
    title: meta.title,
    originalTitle: meta.originalTitle,
    year: meta.year,
    rating: formatRating(meta.rating?.value, 'douban'),
    genres: meta.genres,
    countries: meta.countries,
    duration: meta.duration,
    directors: meta.directors,
    actors: meta.actors.map(actor => ({
      name: actor.name,
      photo: thumbOr(actor.photo, 300),
    })),
    overview: meta.intro,
    poster: thumbOr(meta.cover, 480) ?? '',
    backdrop: thumbOr(meta.backdrop, 780),
    images: meta.images
      .map(image => thumbOr(image.thumb || image.full, 480))
      .filter((path): path is string => path !== null),
    coverSource: meta.backdrop || meta.cover || null,
    favorite,
  }
}

/** 选源会话保留多久（同一部片再打开详情直接复用） */
const SESSION_TTL_MS = 10 * 60 * 1000
/** 一次选源最长多久：有站点一直不返回时到点收尾，不让会话永远停在「正在找源」 */
const SEARCH_DEADLINE_MS = 90 * 1000
/** 客户端这么久没来取结果就当它离开了详情页，剩下的站点不再请求 */
const IDLE_MS = 15 * 1000
/** 最多同时留多少个会话（超出丢最早结束的） */
const MAX_SESSIONS = 20

interface Session {
  id: string
  film: string
  startedAt: number
  /** 客户端最近一次取结果的时间 */
  seenAt: number
  done: boolean
  /** 到时限或客户端离开：剩下的站点不再请求，也不再被复用 */
  stopped: boolean
  groups: EpisodeGroup[]
  /** 结果没变就不重算（客户端每 0.8 秒轮询一次） */
  view: ViewSources | null
}

/** 选源会话：start 在后台开始搜，get 返回当前已找到的站点（整份快照） */
export interface SourceSessions {
  start(title: string): ViewSources
  get(id: string): ViewSources | null
}

export function createSourceSessions(
  deps: SourceDeps,
  now: () => number = Date.now,
  newId: () => string = randomUUID
): SourceSessions {
  const sessions = new Map<string, Session>()
  const view = (s: Session): ViewSources => {
    s.seenAt = now()
    s.view ??= { sessionId: s.id, done: s.done, sites: sourceSites(s.groups) }
    return s.view
  }
  const finish = (s: Session): void => {
    s.stopped = true
    s.done = true
    s.view = null
  }
  const sweep = (): void => {
    for (const s of sessions.values()) {
      if (!s.done && now() - s.startedAt > SEARCH_DEADLINE_MS) finish(s)
      if (now() - s.startedAt > SESSION_TTL_MS) sessions.delete(s.id)
    }
    const finished = [...sessions.values()]
      .filter(s => s.done)
      .sort((a, b) => a.startedAt - b.startedAt)
    while (sessions.size > MAX_SESSIONS && finished.length)
      sessions.delete(finished.shift()!.id)
  }
  return {
    start(title) {
      sweep()
      const film = normalizeTitle(title)
      // 已结束却一个源都没找到的不复用：多半是当时网络不通，重新搜
      const reuse = [...sessions.values()].find(
        s =>
          s.film === film &&
          (s.done
            ? s.groups.length > 0
            : !s.stopped && now() - s.seenAt < IDLE_MS)
      )
      if (reuse) return view(reuse)
      const session: Session = {
        id: newId(),
        film,
        startedAt: now(),
        seenAt: now(),
        done: false,
        stopped: false,
        groups: [],
        view: null,
      }
      sessions.set(session.id, session)
      const active = (): boolean =>
        !session.stopped && now() - session.seenAt < IDLE_MS
      const deadline = new Promise<void>(resolve =>
        setTimeout(resolve, SEARCH_DEADLINE_MS).unref?.()
      )
      void Promise.race([
        searchSources(
          title,
          deps,
          groups => {
            if (session.done) return
            session.groups = [...session.groups, ...groups]
            session.view = null
          },
          active
        ),
        deadline,
      ])
        .catch(() => undefined)
        .finally(() => finish(session))
      return view(session)
    },
    get(id) {
      sweep()
      const session = sessions.get(id)
      return session ? view(session) : null
    },
  }
}

/** 解析一集的播放地址，换成本服务的播放代理路径（防盗链头由代理补） */
export async function resolveEpisode(
  episode: Pick<ViewEpisode, 'url' | 'siteName'> & {
    ext: Record<string, unknown> | null
  },
  deps: PlaySourceDeps
): Promise<ViewPlayable> {
  const resolved = await resolvePlaySource(
    {
      url: episode.url,
      siteName: episode.siteName ?? undefined,
      ext: episode.ext ?? undefined,
    },
    deps
  )
  if (!resolved) return { url: '', direct: false, hls: false }
  const line = splitStreamHeaders(resolved)
  return {
    url: streamProxyPath(line.url, line.headers),
    direct: isDirectMediaUrl(line.url),
    hls: /\.m3u8(?:\?|$)/i.test(line.url),
  }
}
