/** 网盘影片匹配与库外发现的元数据接口；请求经过现有契约与公网出网防护。 */
import { lookup } from 'node:dns/promises'
import { createDoubanBrowse } from '../../engine/online/douban-browse'
import { createDoubanMetadata } from '../../engine/online/douban-metadata'
import { createDoubanTrailers } from '../../engine/online/douban-trailer'
import { ContractError } from '../../shared/contract/define'
import { online } from '../../shared/contract/online'
import { type NetClient, createNetClient } from '../../shared/net/client'
import type { ServerFeatureDeps } from '../features'
import { HttpError, type Router, json, readJson } from '../http/router'

/** 元数据服务的依赖；net 允许测试注入受控网络响应。 */
export type MetadataDeps = Pick<
  ServerFeatureDeps,
  'tmdbToken' | 'tmdbLanguage' | 'log'
> & { net?: NetClient }

const METHODS = [
  'tmdb',
  'doubanBrowse',
  'doubanChart',
  'doubanMetadata',
  'doubanTrailer',
] as const
type MetadataMethod = (typeof METHODS)[number]

function isMetadataMethod(method: string): method is MetadataMethod {
  return METHODS.some(value => value === method)
}

function isDoubanVideo(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'doubanio.com' || url.hostname.endsWith('.doubanio.com'))
  )
}

/** 首页和网盘只开放元数据及豆瓣预告片，其余在线方法返回 404。 */
export function registerNasMetadata(router: Router, deps: MetadataDeps): void {
  const net =
    deps.net ??
    createNetClient({
      fetch,
      lookup: hostname => lookup(hostname, { all: true }),
    })
  const douban = createDoubanBrowse({ net, log: deps.log })
  const metadata = createDoubanMetadata({ net })
  const trailers = createDoubanTrailers({ net })
  router.add('GET', '/api/metadata/trailer', async request => {
    const raw = new URL(request.url).searchParams.get('src')
    let target: URL
    try {
      target = new URL(raw ?? '')
    } catch {
      throw new HttpError(400, '预告片地址不正确')
    }
    if (!isDoubanVideo(target)) throw new HttpError(403, '只允许豆瓣预告片地址')
    const range = request.headers.get('range')
    const { response } = await net.open(String(target), {
      headers: {
        Referer: 'https://movie.douban.com/',
        ...(range ? { Range: range } : {}),
      },
      allow: isDoubanVideo,
      signal: request.signal,
    })
    const headers = new Headers({ 'Cache-Control': 'private, no-store' })
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ]) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(response.body, { status: response.status, headers })
  })
  router.add('POST', '/api/metadata/:method', async (request, { params }) => {
    const method = params.method
    if (!isMetadataMethod(method))
      throw new HttpError(404, 'NAS 不提供这个元数据方法')
    const body = (await readJson(request)) as { args?: unknown } | null
    if (!Array.isArray(body?.args)) throw new HttpError(400, 'args 应为数组')
    let args: unknown[]
    try {
      args = online.calls[method].parse(body.args)
    } catch (error) {
      if (error instanceof ContractError)
        throw new HttpError(400, error.message)
      throw error
    }
    if (method === 'doubanChart') return json(await douban.chart())
    if (method === 'doubanMetadata') {
      const [id, kind] = online.calls.doubanMetadata.parse(args)
      return json(await metadata.get(id, kind))
    }
    if (method === 'doubanTrailer') {
      const [id, kind = 'movie'] = online.calls.doubanTrailer.parse(args)
      return json(await trailers.get(id, kind))
    }
    if (method === 'doubanBrowse') {
      const [query, start] = online.calls.doubanBrowse.parse(args)
      return json(await douban.page(query, start))
    }
    const [path, query = {}] = online.calls.tmdb.parse(args)
    const token = deps.tmdbToken()
    if (!token) return json(null)
    const target = new URL(`https://api.themoviedb.org/3${path}`)
    for (const [key, value] of Object.entries(query))
      target.searchParams.set(key, String(value))
    if (!target.searchParams.get('language'))
      target.searchParams.set('language', deps.tmdbLanguage?.() ?? 'zh-CN')
    return json(
      await net.getJson(String(target), {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 15_000,
        ttlMs: 60_000,
      })
    )
  })
}
