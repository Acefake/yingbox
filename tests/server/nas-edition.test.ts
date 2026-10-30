/** NAS 的实际 HTTP 边界：保留片库/网盘，移除在线/直播，元数据仍经过鉴权和校验。 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'
import { registerServerFeatures } from '../../src/server/nas/features'
import { createNetClient } from '../../src/shared/net/client'
import { defaultDoubanQuery } from '../../src/shared/douban/query'

const TOKEN = 'nas-test-token-abcdefghijklmnop'
const BASE = 'http://127.0.0.1:31480'
let work: string
let app: ServerApp
const outbound: Array<{
  url: string
  authorization: string | null
  range: string | null
  referer: string | null
}> = []

function call(
  path: string,
  body?: unknown,
  authenticated = true,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    host: '127.0.0.1:31480',
    ...extraHeaders,
  }
  if (authenticated) headers.authorization = `Bearer ${TOKEN}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return app.fetch(
    new Request(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  )
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-nas-'))
  const media = join(work, 'media')
  mkdirSync(media)
  const net = createNetClient({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetch: async (url, init) => {
      outbound.push({
        url,
        authorization: new Headers(init.headers).get('authorization'),
        range: new Headers(init.headers).get('range'),
        referer: new Headers(init.headers).get('referer'),
      })
      if (url === 'https://video.doubanio.com/trailer.mp4')
        return new Response(new Uint8Array([1, 2]), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': 'bytes 0-1/100',
            'Accept-Ranges': 'bytes',
          },
        })
      return Response.json(
        url.includes('api.themoviedb.org')
          ? { results: [{ id: 603, title: '黑客帝国' }] }
          : { items: [] }
      )
    },
  })
  app = await createServerApp(
    {
      host: '127.0.0.1',
      port: 31480,
      dataDir: join(work, 'data'),
      cacheDir: join(work, 'cache'),
      mediaRoots: [media],
      webDir: null,
      fetch: { kind: 'node' },
      monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
    },
    {
      codec: inProcessCodec(),
      watch: false,
      log: () => {},
      env: {
        YINGBOX_SERVER_TOKEN: TOKEN,
        YINGBOX_TMDB_TOKEN: 'server-only-token',
        YINGBOX_AUTOGRAB: 'off',
      },
      fetch: async () => new Response('', { status: 404 }),
      netdiskFetch: async () => new Response('', { status: 404 }),
      features: (router, registry, deps) =>
        registerServerFeatures(router, registry, { ...deps, net }),
    }
  )
})
afterAll(async () => {
  await app?.close()
  if (work) rmSync(work, { recursive: true, force: true })
})

describe('NAS 服务', () => {
  it('片库和完整网盘域保持可用', async () => {
    expect(
      await (await call('/api/library/rpc', { method: 'listLibraries' })).json()
    ).toMatchObject({ ok: true, result: [] })
    for (const [domain, method] of [
      ['pan115', 'account'],
      ['autograb', 'overview'],
      ['autograbMovies', 'overview'],
      ['autograbUpgrade', 'overview'],
      ['offline', 'tasks'],
      ['discover', 'status'],
    ]) {
      const response = await call(`/api/domains/${domain}/${method}`, {
        args: [],
      })
      expect(response.status).toBe(200)
      expect(await response.json(), `${domain}.${method}`).toMatchObject({
        ok: true,
      })
    }
  })
  it('没有在线引擎、流代理和直播能力', async () => {
    expect(
      (await call('/api/engine/rpc', { channel: 'online:tmdb', args: [] }))
        .status
    ).toBe(404)
    expect((await call('/api/engine/events')).status).toBe(404)
    expect(
      (await call('/api/stream?src=https://example.com/video.mp4')).status
    ).toBe(404)
    const response = await call('/api/domains/iptv/list', { args: [] })
    expect(await response.json()).toMatchObject({ ok: false })
  })
  it('元数据接口先鉴权，错误参数不发出请求', async () => {
    expect(
      (await call('/api/metadata/tmdb', { args: ['/search/movie'] }, false))
        .status
    ).toBe(401)
    const count = outbound.length
    for (const args of [
      null,
      {},
      [],
      ['https://example.com/'],
      ['/../'],
      ['/search/movie', 'bad'],
    ])
      expect((await call('/api/metadata/tmdb', { args })).status).toBe(400)
    expect(outbound).toHaveLength(count)
    expect(
      (await call('/api/metadata/getJson', { args: ['http://127.0.0.1'] }))
        .status
    ).toBe(404)
    expect(
      (
        await call('/api/metadata/doubanBrowse', {
          args: [defaultDoubanQuery('movie'), -1],
        })
      ).status
    ).toBe(400)
  })
  it('网盘匹配使用服务端令牌和当前元数据语言', async () => {
    const response = await call('/api/metadata/tmdb', {
      args: ['/search/movie', { query: '黑客帝国' }],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [{ id: 603, title: '黑客帝国' }],
    })
    const sent = outbound.at(-1)!
    expect(new URL(sent.url).origin).toBe('https://api.themoviedb.org')
    expect(new URL(sent.url).searchParams.get('language')).toBe('zh-CN')
    expect(sent.authorization).toBe('Bearer server-only-token')
  })
  it('首页榜单和详情使用元数据接口，预告片限制为公网豆瓣视频', async () => {
    expect(
      (await call('/api/metadata/doubanChart', { args: [] }, false)).status
    ).toBe(401)
    expect(
      (await call('/api/metadata/doubanMetadata', { args: ['bad', 'movie'] }))
        .status
    ).toBe(400)
    expect(
      (await call('/api/metadata/doubanTrailer', { args: ['bad'] })).status
    ).toBe(400)
    const count = outbound.length
    expect(
      (await call('/api/metadata/trailer?src=http://127.0.0.1')).status
    ).toBe(403)
    expect(
      (await call('/api/metadata/trailer?src=https://example.com/test.mp4'))
        .status
    ).toBe(403)
    expect(outbound).toHaveLength(count)
    const path =
      '/api/metadata/trailer?src=https://video.doubanio.com/trailer.mp4'
    expect((await call(path, undefined, false)).status).toBe(401)
    const response = await call(path, undefined, true, { range: 'bytes=0-1' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-1/100')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2])
    )
    expect(outbound.at(-1)).toMatchObject({
      authorization: null,
      range: 'bytes=0-1',
      referer: 'https://movie.douban.com/',
    })
  })
})
