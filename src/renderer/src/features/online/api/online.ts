/**
 * 渲染层访问在线域的唯一入口。请求全部在后台引擎经 net 出网（SSRF 防护、超时、大小上限）。
 * 桌面端走 IPC（window.api.online），网页端走片库服务上的引擎（HTTP RPC，services/library-server/engine），
 * 两者是同一个契约生成的同一形状，调用方不区分。
 */
import type {
  DetailImage,
  GetJsonOptions,
} from '../../../../../shared/contract/online'
import type {
  DoubanPage,
  DoubanQuery,
} from '../../../../../shared/douban/query'
import { online } from '../../../../../shared/contract/online'
import { webEngineApi } from '@/services/library-server/engine'

/** 当前环境的在线域：桌面端 IPC，网页端片库服务；都没有时 undefined。 */
function currentApi(): Window['api']['online'] | undefined {
  if (typeof window === 'undefined') return undefined
  return window.api ? window.api.online : (webEngineApi(online) ?? undefined)
}

/** 在线域 API；没有引擎时抛错。 */
export function onlineApi(): Window['api']['online'] {
  const api = currentApi()
  if (!api) throw new Error('在线功能不可用')
  return api
}

/** 有没有在线域（桌面端引擎，或网页端连着的片库服务） */
export function onlineAvailable(): boolean {
  return Boolean(currentApi())
}

/** GET 一个 JSON 接口。 */
export function getJson<T = unknown>(
  url: string,
  options?: GetJsonOptions
): Promise<T> {
  return onlineApi().getJson(url, options) as Promise<T>
}

/** 豆瓣浏览一页（引擎按条件选接口、缓存、熔断）；失败 reject。 */
export function doubanBrowse(
  query: DoubanQuery,
  start: number
): Promise<DoubanPage> {
  // 条件常来自 Vue ref（响应式 Proxy），IPC 结构化克隆不了 Proxy，会在渲染层直接抛错；先拷成普通对象
  return onlineApi().doubanBrowse({ ...query }, start)
}

/** 豆瓣剧照（详情页剧照条的兜底）；失败返回空数组。 */
export function doubanPhotos(
  subjectId: string,
  kind: 'movie' | 'tv'
): Promise<DetailImage[]> {
  return onlineApi().doubanPhotos(subjectId, kind)
}

/**
 * 请求 TMDB v3 接口（路径如 `/search/movie`、`/movie/603/credits`）。令牌在引擎里加，
 * 渲染层拿不到；未配置令牌时返回 null。
 */
export function tmdb<T = unknown>(
  path: string,
  query?: Record<string, string | number>
): Promise<T | null> {
  return onlineApi().tmdb(path, query) as Promise<T | null>
}

/** 拼接查询串。 */
export function withQuery(
  url: string,
  query: Record<string, string | number>
): string {
  const target = new URL(url)
  for (const [key, value] of Object.entries(query))
    target.searchParams.set(key, String(value))
  return String(target)
}
