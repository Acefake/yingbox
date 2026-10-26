/**
 * 渲染层访问在线域的唯一入口。请求全部在后台引擎经 net 出网（SSRF 防护、超时、大小上限）。
 * Web / PWA 模式没有引擎，调用时抛出可读错误。
 */
import type {
  DetailImage,
  GetJsonOptions,
} from '../../../../../shared/contract/online'
import type {
  DoubanPage,
  DoubanQuery,
} from '../../../../../shared/douban/query'

/** 在线域 API；Web 模式下抛错。 */
export function onlineApi(): Window['api']['online'] {
  const api = typeof window !== 'undefined' ? window.api?.online : undefined
  if (!api) throw new Error('在线功能需要桌面端')
  return api
}

/** 有没有在线域（桌面端才有；网页版没有引擎） */
export function onlineAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api?.online)
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
