/**
 * 豆瓣条目简介：按条目 id 取详情（m.douban.com/rexxar/api/v2/<movie|tv>/<id>），读出 intro。
 *
 * 只给中文简介补全用（identify/overview-fill.ts）：与豆瓣补类型共用同一个低速 ProviderHttp（串行、2 秒一次）
 * 和响应缓存；详情按条目缓存 30 天（没有简介、404 也缓存）。rexxar 失败或被风控时回退到 frodo 的同名接口
 * （shared/douban/frodo，同一个限速器、同一个缓存键）。
 */
import {
  type SourceCooldown,
  frodoRequest,
  mapSubject,
  withFrodoFallback,
} from '../../../../shared/douban/frodo'
import type { ResponseCache } from '../http/provider-cache'
import type { ProviderHttp } from '../http/provider-http'
import { DOUBAN_GENRE_TTL_MS } from './douban-genres'

const DETAIL = 'https://m.douban.com/rexxar/api/v2'
const HEADERS = {
  Referer: 'https://m.douban.com/movie/',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
}

/** 要取简介的条目。 */
export interface DoubanSubjectRef {
  id: string
  kind: 'movie' | 'tv'
}

/** 简介去掉首尾空白、合并多余空行；太短（少于 8 个字）当作没有。 */
export function cleanIntro(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
  return text.length >= 8 ? text : ''
}

/** 豆瓣简介查询。 */
export class DoubanIntroLookup {
  /**
   * @param http 限速很低的 HTTP 层（与豆瓣补类型共用）
   * @param cache 响应缓存，用来判断一条查询会不会发请求
   * @param now 当前时间（缓存判断与 frodo 签名的 _ts）
   * @param fallback frodo 回退选项
   */
  constructor(
    private readonly http: ProviderHttp,
    private readonly cache?: Pick<ResponseCache, 'get'>,
    private readonly now: () => number = Date.now,
    private readonly fallback: {
      frodo?: boolean
      cooldown?: SourceCooldown
      log?: (message: string) => void
    } = {}
  ) {}

  /** 详情的缓存键。 */
  static cacheKey(ref: DoubanSubjectRef): string {
    return `douban:subject:${ref.kind}:${ref.id}`
  }

  /** 缓存里有没有这条（有就不占请求名额）。 */
  cached(ref: DoubanSubjectRef): boolean {
    const hit = this.cache?.get(DoubanIntroLookup.cacheKey(ref))
    return Boolean(hit && hit.expiresAt > this.now())
  }

  /** 取简介；条目不存在或没有简介返回空串。网络 / 拦截错误照常抛出。 */
  async intro(ref: DoubanSubjectRef, signal?: AbortSignal): Promise<string> {
    if (!/^\d+$/.test(ref.id)) return ''
    const cacheKey = DoubanIntroLookup.cacheKey(ref)
    const path = `/${ref.kind}/${ref.id}`
    const enabled = Boolean(this.fallback.frodo)
    const body = await withFrodoFallback<unknown>({
      enabled,
      label: '豆瓣补简介',
      rexxar: () =>
        this.http.getJson<unknown>({
          url: `${DETAIL}${path}`,
          headers: HEADERS,
          cacheKey,
          ttl: () => DOUBAN_GENRE_TTL_MS,
          notFoundTtl: enabled ? 0 : DOUBAN_GENRE_TTL_MS,
          signal,
        }),
      frodo: () =>
        this.http.getJson<unknown>({
          ...frodoRequest(path, {}, this.now()),
          cacheKey,
          ttl: () => DOUBAN_GENRE_TTL_MS,
          notFoundTtl: DOUBAN_GENRE_TTL_MS,
          signal,
        }),
      isEmpty: value => !mapSubject(value),
      cooldown: this.fallback.cooldown,
      log: this.fallback.log,
      signal,
    })
    return cleanIntro(mapSubject(body)?.intro ?? '')
  }
}
