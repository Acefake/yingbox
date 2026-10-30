/** NAS 保留的元数据访问与片库直链播放；不依赖 CMS 或在线引擎。 */
import { libraryServerState, serverFetch } from '@/services/library-server'
import type {
  DoubanPage,
  DoubanQuery,
  DoubanSubject,
} from '../../../shared/douban/query'
import type { DoubanMetadata } from '../../../shared/douban/detail'

async function request<T>(
  method:
    | 'tmdb'
    | 'doubanBrowse'
    | 'doubanChart'
    | 'doubanMetadata'
    | 'doubanTrailer',
  args: unknown[]
): Promise<T> {
  const response = await serverFetch(`/api/metadata/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  if (!response.ok) throw new Error(`元数据请求失败（HTTP ${response.status}）`)
  return response.json() as Promise<T>
}

/** 请求 TMDB；令牌只由服务端读取，未配置时返回 null。 */
export function tmdb<T = unknown>(
  path: string,
  query?: Record<string, string | number>
): Promise<T | null> {
  return request('tmdb', [path, query ?? {}])
}

/** 读取库外发现的豆瓣片单。 */
export function doubanBrowse(
  query: DoubanQuery,
  start: number
): Promise<DoubanPage> {
  return request('doubanBrowse', [{ ...query }, start])
}

/** 首页的豆瓣榜单。 */
export function doubanChart(): Promise<DoubanSubject[]> {
  return request('doubanChart', [])
}

/** 首页轮播所需的简介和剧照。 */
export function doubanMetadata(
  id: string,
  kind: 'movie' | 'tv'
): Promise<DoubanMetadata | null> {
  return request('doubanMetadata', [id, kind])
}

/** 首页元数据在当前 NAS 服务已连接时可用。 */
export function onlineAvailable(): boolean {
  return libraryServerState().value === 'online'
}

/** 保留首页预告片接口，返回受限的同源预告片地址。 */
export function onlineApi(): {
  doubanTrailer(id: string, kind: 'movie' | 'tv'): Promise<string | null>
} {
  return {
    async doubanTrailer(id, kind) {
      const url = await request<string | null>('doubanTrailer', [id, kind])
      return url ? `/api/metadata/trailer?src=${encodeURIComponent(url)}` : null
    },
  }
}

/** NAS 播放的是片库提供的媒体地址，不解析第三方站点页面。 */
export async function resolvePlaySource(item: {
  url?: string
}): Promise<string> {
  return item.url?.trim() ?? ''
}
