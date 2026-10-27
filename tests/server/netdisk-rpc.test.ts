/**
 * 独立服务的网盘类接口（不占端口，直接调 app.fetch）：契约域 HTTP RPC（参数校验、错误以数据返回、鉴权）、
 * SSE 事件、服务端设置（白名单、校验、环境变量固定）、PanSou 搜索读服务端设置、YINGBOX_NETDISK=off。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { type ServerApp, createServerApp } from '../../src/server/app'
import type { ServerConfig } from '../../src/server/config'
import {
  DOMAIN_HTTP,
  type DomainEventMessage,
} from '../../src/shared/contract/http-wire'
import { SERVER_SETTINGS_HTTP } from '../../src/shared/settings/server-keys'
import { PANSOU_WRAPPED, fakeFetch } from '../pan115/fixtures'

const TOKEN = 'test-token-abcdefghijklmnop'
const BASE = 'http://127.0.0.1:31480'

/** 起一个服务；返回调用助手 */
async function start(
  work: string,
  env: NodeJS.ProcessEnv,
  netdiskFetch?: (url: string, init?: RequestInit) => Promise<Response>
): Promise<{
  app: ServerApp
  call(path: string, init?: RequestInit & { auth?: boolean }): Promise<Response>
  rpc(domain: string, method: string, args?: unknown): Promise<unknown>
}> {
  mkdirSync(join(work, 'media'), { recursive: true })
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 31480,
    dataDir: join(work, 'data'),
    cacheDir: join(work, 'cache'),
    mediaRoots: [join(work, 'media')],
    webDir: null,
    fetch: { kind: 'node' },
    monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
  }
  const app = await createServerApp(config, {
    fetch: (async () => new Response('', { status: 404 })) as never,
    codec: inProcessCodec(),
    watch: false,
    log: () => {},
    env: { YINGBOX_SERVER_TOKEN: TOKEN, ...env },
    netdiskFetch,
  })
  const call = (
    path: string,
    init: RequestInit & { auth?: boolean } = {}
  ): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('host', '127.0.0.1:31480')
    if (init.auth !== false) headers.set('authorization', `Bearer ${TOKEN}`)
    return app.fetch(new Request(BASE + path, { ...init, headers }))
  }
  const rpc = async (
    domain: string,
    method: string,
    args: unknown = []
  ): Promise<unknown> =>
    (
      await call(DOMAIN_HTTP.rpc(domain, method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args }),
      })
    ).json()
  return { app, call, rpc }
}

let work: string
let server: Awaited<ReturnType<typeof start>>
const pan = fakeFetch({ 'http://pansou.lan/api/search': PANSOU_WRAPPED })

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-netdisk-'))
  server = await start(work, { YINGBOX_MOUNT_ROOT: '/mnt/115' }, pan.fetch)
})
afterAll(async () => {
  await server?.app.close()
  rmSync(work, { recursive: true, force: true })
})

describe('契约域 HTTP RPC', () => {
  it('需要令牌；成功返回 { ok, value }，契约同桌面端', async () => {
    const res = await server.call(DOMAIN_HTTP.rpc('pan115', 'account'), {
      method: 'POST',
      auth: false,
      headers: { 'content-type': 'application/json' },
      body: '{"args":[]}',
    })
    expect(res.status).toBe(401)
    expect(await server.rpc('pan115', 'account')).toEqual({
      ok: true,
      value: { loggedIn: false },
    })
    expect(await server.rpc('pan115', 'dirs', ['0'])).toEqual({
      ok: true,
      value: { ok: false, error: expect.stringContaining('扫码登录') },
    })
  })

  it('参数不合法、方法 / 域不存在都以数据返回失败', async () => {
    expect(await server.rpc('pan115', 'search', [42])).toEqual({
      ok: false,
      error: expect.stringContaining('[pan115:search] 参数 keyword'),
    })
    expect(await server.rpc('pan115', 'nope')).toEqual({
      ok: false,
      error: '未知方法：pan115:nope',
    })
    expect(await server.rpc('online', 'search', ['x'])).toEqual({
      ok: false,
      error: '片库服务没有启用 online',
    })
    expect(await server.rpc('pan115', 'account', 'x')).toMatchObject({
      ok: false,
    })
  })

  it('六个域都已登记：追更 / 洗版 / 电影追踪 / 库外发现 / 离线下载', async () => {
    const overview = (await server.rpc('autograb', 'overview')) as {
      ok: boolean
      value: { enabled: boolean }
    }
    expect(overview.ok).toBe(true)
    expect(await server.rpc('discover', 'status')).toMatchObject({ ok: true })
    expect(await server.rpc('autograbUpgrade', 'overview')).toMatchObject({
      ok: true,
    })
    expect(await server.rpc('autograbMovies', 'overview')).toMatchObject({
      ok: true,
    })
    expect(await server.rpc('offline', 'tasks')).toEqual({
      ok: true,
      value: { loggedIn: false, folder: '', tasks: [], checkedAt: null },
    })
    expect(
      await server.rpc('offline', 'add', [
        [`magnet:?xt=urn:btih:${'a'.repeat(40)}`],
      ])
    ).toEqual({
      ok: true,
      value: {
        ok: false,
        error: expect.stringContaining('扫码登录'),
        setup: 'login',
      },
    })
    expect(await server.rpc('offline', 'add', [['https://x']])).toMatchObject({
      ok: false,
      error: expect.stringContaining('磁力或电驴'),
    })
  })

  it('事件经 SSE 推送：autograb.setEnabled → changed', async () => {
    const controller = new AbortController()
    const res = await server.call(DOMAIN_HTTP.events, {
      signal: controller.signal,
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value)
    expect(text).toContain(': connected')
    await server.rpc('autograb', 'setEnabled', [true])
    while (!text.includes('data: '))
      text += decoder.decode((await reader.read()).value)
    const line = text.split('\n').find(l => l.startsWith('data: '))!
    expect(JSON.parse(line.slice(6)) as DomainEventMessage).toEqual({
      domain: 'autograb',
      event: 'changed',
      payload: null,
    })
    controller.abort()
    await reader.cancel().catch(() => {})
  })
})

describe('服务端设置', () => {
  const post = (body: unknown): Promise<Response> =>
    server.call(SERVER_SETTINGS_HTTP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('快照带默认值与环境变量固定的键', async () => {
    const snapshot = await (await server.call(SERVER_SETTINGS_HTTP)).json()
    expect(snapshot.values).toMatchObject({
      'pan115.pansouUrl': '',
      'pan115.targetCid': '0',
      'library.notify.mountRoot': '/mnt/115',
    })
    expect(snapshot.locked).toEqual(['library.notify.mountRoot'])
  })

  it('刮削偏好存在服务端，改了立即下发给片库（与桌面端同一条路）', async () => {
    expect(server.app.service.identifier.provider.language).toBe('zh-CN')
    const saved = await post({ key: 'scrape.metadataLanguage', value: 'zh-TW' })
    expect(await saved.json()).toEqual({ ok: true, value: 'zh-TW' })
    // 下发是写入后排队执行的
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(server.app.service.identifier.provider.language).toBe('zh-TW')
    await post({ key: 'scrape.metadataLanguage', value: 'zh-CN' })
  })

  it('白名单外、值不合法、被环境变量固定的键都 400', async () => {
    expect((await post({ key: 'ui.theme', value: 'dark' })).status).toBe(400)
    expect((await post({ key: 'pan115.targetCid', value: 'abc' })).status).toBe(
      400
    )
    const locked = await post({ key: 'library.notify.mountRoot', value: '/x' })
    expect(locked.status).toBe(400)
    expect((await locked.json()).error).toContain('YINGBOX_MOUNT_ROOT')
  })

  it('写入后网盘模块立即读到：PanSou 搜索用服务端保存的地址', async () => {
    expect(await server.rpc('pan115', 'search', ['三体'])).toEqual({
      ok: true,
      value: { ok: false, error: expect.stringContaining('PanSou 或 Torznab') },
    })
    const saved = await post({
      key: 'pan115.pansouUrl',
      value: 'http://pansou.lan',
    })
    expect(await saved.json()).toEqual({ ok: true, value: 'http://pansou.lan' })
    const result = (await server.rpc('pan115', 'search', ['三体'])) as {
      value: { ok: boolean; items: unknown[] }
    }
    expect(result.value.ok).toBe(true)
    expect(result.value.items.length).toBeGreaterThan(0)
    expect(pan.sent.at(-1)?.url).toBe('http://pansou.lan/api/search')
    expect(existsSync(join(work, 'data/server-settings.json'))).toBe(true)
  })
})

describe('YINGBOX_NETDISK=off', () => {
  it('不登记网盘类接口（服务端设置照常可用：刮削偏好也存在这里）', async () => {
    const other = mkdtempSync(join(tmpdir(), 'yingbox-netdisk-off-'))
    const off = await start(other, { YINGBOX_NETDISK: 'off' })
    try {
      expect((await off.call(SERVER_SETTINGS_HTTP)).status).toBe(200)
      expect(
        (
          await off.call(DOMAIN_HTTP.rpc('pan115', 'account'), {
            method: 'POST',
          })
        ).status
      ).toBe(404)
    } finally {
      await off.app.close()
      rmSync(other, { recursive: true, force: true })
    }
  })
})
