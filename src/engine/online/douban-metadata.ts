import type { DoubanMetadata } from '../../shared/douban/detail'
import type { NetClient } from '../../shared/net/client'
import {
  createSourceCooldown,
  frodoEnabled,
  mapSubject,
  rexxarToFrodo,
  withFrodoFallback,
} from '../../shared/douban/frodo'
import { parseDoubanPhotos } from './douban-photos'

type Json = Record<string, unknown>
const object = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const image = (v: unknown): string =>
  /^https:\/\/[^\s"'<>]+$/.test(text(v)) ? text(v) : ''

function parseActors(value: unknown): DoubanMetadata['actors'] {
  return list(value)
    .map(v => {
      const actor = object(v)
      return {
        name: text(actor.name),
        photo: image(object(actor.avatar).normal) || image(actor.cover_url),
      }
    })
    .filter(v => v.name)
}

/** 校验并收取豆瓣详情字段；验证页和错误响应返回 null。 */
export function parseDoubanMetadata(body: unknown): DoubanMetadata | null {
  const base = mapSubject(body)
  if (!base) return null
  const raw = object(body)
  return {
    ...base,
    cover: image(base.cover),
    duration: list(raw.durations).map(text).filter(Boolean).join(' / '),
    directors: list(raw.directors)
      .map(v => text(object(v).name))
      .filter(Boolean),
    actors: parseActors(raw.actors).slice(0, 14),
    images: [],
    backdrop: '',
  }
}

/** 无需用户令牌的详情服务；并发去重、成功缓存一小时，失败短暂冷却。 */
export function createDoubanMetadata(options: {
  net: {
    getJson: (...args: Parameters<NetClient['getJson']>) => Promise<unknown>
  }
  now?: () => number
  frodo?: boolean
}): { get(id: string, kind: 'movie' | 'tv'): Promise<DoubanMetadata | null> } {
  const now = options.now ?? Date.now
  const cooldown = createSourceCooldown(60_000, now)
  const cache = new Map<
    string,
    { value: DoubanMetadata | null; until: number }
  >()
  const inflight = new Map<string, Promise<DoubanMetadata | null>>()
  const request = async (url: string): Promise<unknown> =>
    withFrodoFallback({
      enabled: options.frodo ?? frodoEnabled(),
      label: '豆瓣详情',
      cooldown,
      rexxar: () =>
        options.net.getJson(url, {
          headers: {
            Referer: 'https://m.douban.com/',
            'User-Agent': 'Mozilla/5.0',
          },
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
        }),
      frodo: () => {
        const signed = rexxarToFrodo(url, now())!
        return options.net.getJson(signed.url, {
          headers: signed.headers,
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
        })
      },
      isEmpty: body =>
        url.endsWith('/celebrities')
          ? !parseActors(object(body).actors).length
          : !parseDoubanMetadata(body) && !Array.isArray(object(body).photos),
    })

  return {
    /** 只接受经过契约校验的数字 ID；图片失败不影响详情。 */
    get(id: string, kind: 'movie' | 'tv'): Promise<DoubanMetadata | null> {
      const key = `${kind}/${id}`
      const hit = cache.get(key)
      if (hit && hit.until > now()) return Promise.resolve(hit.value)
      const pending = inflight.get(key)
      if (pending) return pending
      const url = `https://m.douban.com/rexxar/api/v2/${key}`
      const task = request(url)
        .then(async body => {
          const detail = parseDoubanMetadata(body)
          if (!detail || detail.id !== id) return null
          detail.kind = kind
          const [photos, celebrities] = await Promise.all([
            request(`${url}/photos?start=0&count=40`).catch(() => null),
            detail.actors.some(actor => !actor.photo)
              ? request(`${url}/celebrities`).catch(() => null)
              : Promise.resolve(null),
          ])
          const actors = parseActors(object(celebrities).actors)
          detail.actors = detail.actors.map(actor => ({
            ...actor,
            photo:
              actor.photo ||
              actors.find(v => v.name === actor.name)?.photo ||
              '',
          }))
          if (photos && Array.isArray(object(photos).photos)) {
            detail.images = parseDoubanPhotos(photos)
            const landscape = list(object(photos).photos).find(v => {
              const large = object(object(object(v).image).large)
              return (
                Number(large.width) > Number(large.height) &&
                Number(large.height) > 0 &&
                image(large.url)
              )
            })
            detail.backdrop = image(
              object(object(object(landscape).image).large).url
            )
          }
          return detail
        })
        .catch(() => null)
        .then(value => {
          cache.delete(key)
          cache.set(key, { value, until: now() + (value ? 3600_000 : 30_000) })
          while (cache.size > 200) cache.delete(cache.keys().next().value!)
          return value
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, task)
      return task
    },
  }
}
