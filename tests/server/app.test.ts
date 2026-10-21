/**
 * 独立片库服务端到端（不占端口，直接调 app.fetch）：
 * 鉴权 → 建库（根目录限制）→ 扫描 + 番号识别（录制页面回放）→ 查询 → 海报缩略图（wasm）→ 视频 Range → SSE → 网页托管。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  InvokeResult,
  LibraryItemSummary,
} from '../../src/shared/library/ipc'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'
import type { ServerConfig } from '../../src/server/config'

const fixtures = join(__dirname, '../fixtures')
const PAGES: Record<string, string> = {
  'https://www.javbus.com/SSIS-497': readFileSync(
    join(fixtures, 'jav/javbus-SSIS-497.html'),
    'utf8'
  ),
  'https://www.avbase.net/works/SSIS-497': readFileSync(
    join(fixtures, 'jav/avbase-work.html'),
    'utf8'
  ),
}
const COVER = readFileSync(join(fixtures, 'images/cover-800x538.jpg'))

const fakeFetch = async (url: string): Promise<Response> => {
  if (PAGES[url])
    return new Response(PAGES[url], {
      headers: { 'content-type': 'text/html' },
    })
  if (/\.jpe?g$/.test(url))
    return new Response(new Uint8Array(COVER), {
      headers: { 'content-type': 'image/jpeg' },
    })
  return new Response('not found', { status: 404 })
}

const TOKEN = 'test-token-abcdefghijklmnop'
let work: string
let media: string
let app: ServerApp

const BASE = 'http://127.0.0.1:31480'
const call = (
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<Response> => {
  const headers = new Headers(init.headers)
  headers.set('host', '127.0.0.1:31480')
  if (init.auth !== false) headers.set('authorization', `Bearer ${TOKEN}`)
  return app.fetch(new Request(BASE + path, { ...init, headers }))
}
const rpc = async (method: string, params?: unknown): Promise<InvokeResult> =>
  (await (
    await call('/api/library/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
  ).json()) as InvokeResult

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-server-'))
  media = join(work, 'media')
  const write = (path: string, size: number): void => {
    mkdirSync(dirname(join(media, path)), { recursive: true })
    writeFileSync(join(media, path), Buffer.alloc(size, 7))
  }
  write('SSIS-497/SSIS-497-C.mp4', 4096)
  write('random video.mp4', 16)
  mkdirSync(join(work, 'web/assets'), { recursive: true })
  writeFileSync(join(work, 'web/index.html'), '<div id="app"></div>')
  writeFileSync(join(work, 'web/assets/a.js'), 'console.log(1)')
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 31480,
    dataDir: join(work, 'data'),
    mediaRoots: [media],
    webDir: join(work, 'web'),
    fetch: { kind: 'node' },
    monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
  }
  app = await createServerApp(config, {
    fetch: fakeFetch as never,
    codec: inProcessCodec(),
    watch: false,
    log: () => {},
    env: { YINGBOX_SERVER_TOKEN: TOKEN },
  })
})

afterAll(async () => {
  await app?.close()
  rmSync(work, { recursive: true, force: true })
})

describe('鉴权', () => {
  it('健康检查公开，API 与媒体需要令牌', async () => {
    expect(await (await call('/api/health', { auth: false })).json()).toEqual({
      ok: true,
      authorized: false,
    })
    expect((await call('/api/info', { auth: false })).status).toBe(401)
    expect((await call('/media/files/1', { auth: false })).status).toBe(401)
    expect((await call('/api/info')).status).toBe(200)
  })

  it('登录换 HttpOnly Cookie，Cookie 可代替 Bearer', async () => {
    const bad = await call('/api/session', {
      auth: false,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' }),
    })
    expect(bad.status).toBe(401)
    const ok = await call('/api/session', {
      auth: false,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })
    expect(ok.status).toBe(204)
    const cookie = ok.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Strict/)
    const info = await call('/api/info', {
      auth: false,
      headers: { cookie: cookie.split(';')[0] },
    })
    expect(info.status).toBe(200)
  })

  it('跨站写请求被拒；?token= 打开首页写 Cookie 并去掉令牌', async () => {
    const cross = await call('/api/library/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ method: 'listLibraries' }),
    })
    expect(cross.status).toBe(403)
    const open = await call(`/?token=${TOKEN}`, { auth: false })
    expect(open.status).toBe(302)
    expect(open.headers.get('location')).toBe('/')
    expect(open.headers.get('set-cookie')).toMatch(/^yingbox_token=/)
  })
})

describe('片库流程', () => {
  let ssis: LibraryItemSummary

  it('只能添加媒体根目录内的文件夹', async () => {
    const outside = await rpc('addLibrary', { root: tmpdir(), kind: 'movie' })
    expect(outside).toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    const missing = await rpc('addLibrary', {
      root: join(media, 'nope'),
      kind: 'movie',
    })
    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
  })

  it('建库 → 扫描 → 番号识别 → 查询', async () => {
    const added = await rpc('addLibrary', {
      root: media,
      kind: 'movie',
      source: 'jav',
    })
    expect(added.ok).toBe(true)
    await app.service.queue.idle()
    const result = await rpc('query', { sort: 'title' })
    if (!result.ok) throw new Error(result.error.message)
    const items = (result.result as { items: LibraryItemSummary[] }).items
    expect(items).toHaveLength(2)
    ssis = items.find(it => it.title.startsWith('SSIS-497'))!
    expect(ssis).toMatchObject({ matchState: 'auto' })
    expect(ssis.poster).toMatch(/^yingbox-media:\/\/image\/[0-9a-f]{32}$/)
  })

  it('海报：/media/image/<key>?w=300 现生成 WebP，协商缓存回 304', async () => {
    const key = ssis.poster!.split('/').pop()!
    const res = await call(`/media/image/${key}?w=300`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP')
    const again = await call(`/media/image/${key}?w=300`, {
      headers: { 'if-none-match': res.headers.get('etag')! },
    })
    expect(again.status).toBe(304)
    expect((await call(`/media/image/${key}?w=123`)).status).toBe(404)
  })

  it('远程图片代理只接受 http(s)', async () => {
    const res = await call(
      `/media/thumb?w=300&src=${encodeURIComponent('file:///etc/hosts')}`
    )
    expect(res.status).toBe(400)
  })

  it('视频 Range 流只给片库里登记过的视频', async () => {
    const node = await rpc('getItem', { itemId: ssis.id })
    if (!node.ok) throw new Error(node.error.message)
    const file = (
      node.result as { files: Array<{ id: number; kind: string }> }
    ).files.find(f => f.kind === 'video')!
    const res = await call(`/media/files/${file.id}`, {
      headers: { range: 'bytes=0-99' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-99/4096')
    expect((await res.arrayBuffer()).byteLength).toBe(100)
    expect((await call('/media/files/999999')).status).toBe(404)
  })

  it('目录浏览限制在根目录内', async () => {
    const roots = await (await call('/api/fs/dirs')).json()
    expect(roots).toEqual({
      path: null,
      parent: null,
      dirs: [{ name: 'media', path: media }],
    })
    const inside = await (
      await call(`/api/fs/dirs?path=${encodeURIComponent(media)}`)
    ).json()
    expect(inside.dirs.map((d: { name: string }) => d.name)).toEqual([
      'SSIS-497',
    ])
    expect(inside.parent).toBeNull()
    expect(
      (await call(`/api/fs/dirs?path=${encodeURIComponent(work)}`)).status
    ).toBe(404)
  })

  it('SSE 推送引擎事件', async () => {
    const controller = new AbortController()
    const res = await call('/api/library/events', { signal: controller.signal })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value)
    expect(text).toContain(': connected')
    await rpc('scan', { libraryId: 1 })
    while (!text.includes('data: '))
      text += decoder.decode((await reader.read()).value)
    expect(JSON.parse(/data: (.+)\n/.exec(text)![1])).toHaveProperty('type')
    controller.abort()
    await reader.cancel()
  })

  it('网页端设置 TMDB 令牌：存进服务密钥文件', async () => {
    const result = await rpc('setProviderToken', {
      provider: 'tmdb',
      token: 'eyJabc',
    })
    expect(result).toMatchObject({
      ok: true,
      result: { tmdb: { configured: true } },
    })
    const secrets = JSON.parse(
      readFileSync(join(work, 'data/secrets.json'), 'utf8')
    )
    expect(secrets['scrape.tmdbToken']).toBe('eyJabc')
  })
})

describe('网页托管', () => {
  it('静态文件、SPA 回退、穿越防护', async () => {
    const asset = await call('/assets/a.js', { auth: false })
    expect(asset.headers.get('cache-control')).toMatch(/immutable/)
    expect(await (await call('/some/route', { auth: false })).text()).toContain(
      'id="app"'
    )
    expect(
      await (await call('/..%2f..%2fetc%2fpasswd', { auth: false })).text()
    ).toContain('id="app"')
    expect((await call('/api/nope')).status).toBe(404)
  })
})
