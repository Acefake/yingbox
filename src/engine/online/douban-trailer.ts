/**
 * 豆瓣预告片地址（豆瓣卡悬停预览用）。
 *
 * 1. m.douban.com/rexxar/api/v2/<movie|tv>/<id>：移动端接口，要 Referer https://m.douban.com/ 与移动 UA；
 *    返回 trailer.video_url / trailers[].video_url。接口正常返回了条目但没有预告 = 无预告；
 * 2. 接口失败（302 到验证页、403、超时、不是 JSON）再解析 movie.douban.com/subject/<id>/trailer
 *    里第一个 /trailer/<tid>/，取那一页 <video><source src=…mp4>。
 *
 * 结果（含「无预告」）存内存并落盘（userData/online/douban-trailers.json，tmp + rename 原子写）。
 * 预告地址带时间戳签名，只缓存 6 小时；无预告缓存 7 天。请求失败不缓存，两个主机分别熔断
 * （连续 3 次失败，冷却 10 分钟），冷却期内直接返回 null，不发请求。
 *
 * 视频本身由渲染层 <video> 直接取，doubanio.com 的 Referer 由主进程会话补（shared/net/media-referer.ts）。
 * 沙箱在海外，豆瓣对海外出口会 302，真实行为以国内实测为准。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { NetClient } from '../../shared/net/client'
import {
  type HostBreaker,
  createHostBreaker,
} from '../../shared/net/host-breaker'

/** 找到的预告地址缓存 6 小时（地址带时效签名） */
export const TRAILER_TTL_MS = 6 * 60 * 60 * 1000
/** 「无预告」缓存 7 天 */
export const NO_TRAILER_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 落盘最多保留的条目数（超出丢最早的） */
const MAX_ENTRIES = 2000

const REXXAR = 'https://m.douban.com/rexxar/api/v2'
const MOVIE = 'https://movie.douban.com'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 条目类型 */
export type DoubanKind = 'movie' | 'tv'

interface Entry {
  url: string | null
  at: number
}

/** 取预告的服务。 */
export interface DoubanTrailers {
  /** 预告片 mp4 地址；无预告、请求失败、熔断中都返回 null */
  get(subjectId: string, kind: DoubanKind): Promise<string | null>
  /** 等待落盘完成（测试与退出用） */
  flush(): Promise<void>
}

/** 依赖。 */
export interface DoubanTrailerOptions {
  net: NetClient
  /** 落盘文件；不给只在内存里 */
  file?: string
  now?: () => number
  breaker?: HostBreaker
}

const isMp4 = (url: unknown): url is string =>
  typeof url === 'string' &&
  /^https:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?$/i.test(url)

const onMovieHost = (url: string): boolean => {
  try {
    return new URL(url).hostname === 'movie.douban.com'
  } catch {
    return false
  }
}

/**
 * 解析 rexxar 条目：预告地址；条目正常但没有预告为 null；不像条目（验证页、错误）为 undefined。
 */
export function parseRexxarTrailer(json: unknown): string | null | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined
  const data = json as Record<string, unknown>
  if (!['id', 'title', 'trailer', 'trailers'].some(key => key in data))
    return undefined
  const candidates = [
    (data.trailer as { video_url?: unknown } | null | undefined)?.video_url,
    ...(Array.isArray(data.trailers) ? data.trailers : []).map(
      t => (t as { video_url?: unknown } | null)?.video_url
    ),
  ]
  return candidates.find(isMp4) ?? null
}

/** 预告片列表页里第一个预告片的 ID */
export function findTrailerPageId(html: string): string | null {
  return /movie\.douban\.com\/trailer\/(\d+)\//.exec(html)?.[1] ?? null
}

/** 预告片页 <video> 里第一个 mp4 的 <source src> */
export function findTrailerVideo(html: string): string | null {
  const video = /<video\b[\s\S]*?<\/video>/i.exec(html)?.[0] ?? ''
  for (const tag of video.match(/<source\b[^>]*>/gi) ?? []) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (isMp4(src)) return src
  }
  return null
}

/** 创建取预告服务。 */
export function createDoubanTrailers(
  options: DoubanTrailerOptions
): DoubanTrailers {
  const { net, file } = options
  const now = options.now ?? Date.now
  const breaker =
    options.breaker ??
    createHostBreaker({ threshold: 3, cooldownMs: 10 * 60 * 1000, now })
  const memory = new Map<string, Entry>()
  const inflight = new Map<string, Promise<string | null>>()
  let loaded: Promise<void> | null = null
  let writing: Promise<void> = Promise.resolve()

  const load = (): Promise<void> =>
    (loaded ??= (async () => {
      if (!file) return
      try {
        const saved = JSON.parse(await readFile(file, 'utf8')) as {
          entries?: Record<string, Entry>
        }
        for (const [key, entry] of Object.entries(saved.entries ?? {}))
          if (typeof entry?.at === 'number') memory.set(key, entry)
      } catch {
        // 没有文件或已损坏：当空
      }
    })())

  const persist = (): void => {
    if (!file) return
    while (memory.size > MAX_ENTRIES)
      memory.delete(memory.keys().next().value as string)
    const body = JSON.stringify({ entries: Object.fromEntries(memory) })
    writing = writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(`${file}.tmp`, body)
        await rename(`${file}.tmp`, file)
      })
      .catch(() => {})
  }

  const fresh = (entry: Entry | undefined): entry is Entry =>
    !!entry &&
    now() - entry.at < (entry.url ? TRAILER_TTL_MS : NO_TRAILER_TTL_MS)

  /** 带熔断的一次请求；熔断中或失败返回 undefined */
  async function guarded<T>(
    url: string,
    run: () => Promise<T>
  ): Promise<T | undefined> {
    if (breaker.check(url)) return undefined
    try {
      const value = await run()
      breaker.succeed(url)
      return value
    } catch {
      breaker.fail(url, 'unreachable')
      return undefined
    }
  }

  /** undefined = 两条路都失败（不缓存） */
  async function lookup(
    id: string,
    kind: DoubanKind
  ): Promise<string | null | undefined> {
    const api = `${REXXAR}/${kind}/${id}`
    const json = await guarded(api, () =>
      net.getJson(api, {
        headers: { Referer: 'https://m.douban.com/', 'User-Agent': MOBILE_UA },
        timeoutMs: 8000,
      })
    )
    const fromApi = json === undefined ? undefined : parseRexxarTrailer(json)
    if (fromApi !== undefined) return fromApi
    const list = `${MOVIE}/subject/${id}/trailer`
    const listHtml = await guarded(list, async () => {
      const page = await net.getText(list, { timeoutMs: 8000 })
      // 跳到验证页 / 登录页（sec.douban.com、accounts）或拿到的不是这个条目的页：算失败，不当成无预告
      if (!onMovieHost(page.url) || !page.text.includes(`/subject/${id}/`))
        throw new Error('不是预告片列表页')
      return page.text
    })
    if (listHtml === undefined) return undefined
    const tid = findTrailerPageId(listHtml)
    if (!tid) return null
    const pageUrl = `${MOVIE}/trailer/${tid}/`
    const html = await guarded(pageUrl, async () => {
      const page = await net.getText(pageUrl, { timeoutMs: 8000 })
      if (!onMovieHost(page.url)) throw new Error('不是预告片页')
      return page.text
    })
    if (html === undefined) return undefined
    return findTrailerVideo(html)
  }

  return {
    async get(subjectId, kind) {
      if (!/^\d{1,12}$/.test(subjectId)) return null
      const key = `${kind}:${subjectId}`
      await load()
      const cached = memory.get(key)
      if (fresh(cached)) return cached.url
      const pending = inflight.get(key)
      if (pending) return pending
      const task = lookup(subjectId, kind)
        .then(url => {
          if (url === undefined) return null
          memory.delete(key)
          memory.set(key, { url, at: now() })
          persist()
          return url
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, task)
      return task
    },
    flush: () => writing,
  }
}
