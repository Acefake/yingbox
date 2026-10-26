/**
 * 独立服务的在线引擎：HTTP RPC 按契约校验后转发、错误编码、SSE 推事件、鉴权（rpc / events / stream 都要令牌），
 * 以及真实的 child_process 引擎（src/engine/node.ts，经 EngineHost / UtilityHost 托管）能跑通调用。
 */
import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inProcessCodec } from '../../src/main/thumbnails/codec-client'
import { UtilityCallError } from '../../src/main/utility/host'
import { type ServerApp, createServerApp } from '../../src/server/app'
import type { ServerConfig } from '../../src/server/config'
import { loadOnlineConfig } from '../../src/server/online/config'
import { createNodeBrowserFetch } from '../../src/server/online/browser-fetch'
import {
  type ServerEngine,
  createServerEngine,
  wrapChild,
} from '../../src/server/online/engine'
import { invokeEngine } from '../../src/server/online/rpc-route'
import {
  ENGINE_HTTP,
  type EngineEventMessage,
  type EngineRpcResult,
  streamProxyPath,
} from '../../src/shared/engine-http'

/** 假引擎：记录调用，按通道回结果；能手动推事件。 */
function fakeEngine(): ServerEngine & {
  calls: Array<{ channel: string; args: unknown[] }>
  emit(event: EngineEventMessage): void
} {
  const listeners = new Set<(event: EngineEventMessage) => void>()
  const calls: Array<{ channel: string; args: unknown[] }> = []
  return {
    calls,
    async invoke(channel, args) {
      calls.push({ channel, args })
      if (channel === 'online:resolvePage')
        throw new UtilityCallError('后台引擎已退出（code 1）', 'unavailable')
      if (channel === 'online:probeStream') throw new Error('boom')
      return { channel, args }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    },
    shutdown: async () => {},
  }
}

describe('invokeEngine', () => {
  it('按契约解析参数后转发；未知通道、同步调用、坏参数不转发', async () => {
    const engine = fakeEngine()
    const ok = await invokeEngine(engine, 'online:doubanTrailer', ['123'])
    expect(ok).toEqual({
      ok: true,
      value: { channel: 'online:doubanTrailer', args: ['123', 'movie'] },
    })
    const bad: EngineRpcResult[] = [
      await invokeEngine(engine, 'online:nope', []),
      await invokeEngine(engine, 'settings:get', []),
      await invokeEngine(engine, 'online:tmdb', ['/account']),
      await invokeEngine(engine, 'online:getJson', 'x'),
      await invokeEngine(engine, 42, []),
    ]
    for (const result of bad) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid-params')
    }
    expect(engine.calls).toHaveLength(1)
  })

  it('引擎错误带上码：崩溃 / 关停为 unavailable，其余为 engine', async () => {
    const engine = fakeEngine()
    expect(
      await invokeEngine(engine, 'online:resolvePage', ['https://a.b/'])
    ).toEqual({
      ok: false,
      error: { code: 'unavailable', message: '后台引擎已退出（code 1）' },
    })
    expect(
      await invokeEngine(engine, 'online:probeStream', ['https://a.b/'])
    ).toEqual({
      ok: false,
      error: { code: 'engine', message: 'boom' },
    })
  })
})

describe('服务端路由', () => {
  const TOKEN = 'online-token-abcdefghijklmnop'
  let work: string
  let app: ServerApp
  const engine = fakeEngine()
  const call = (
    path: string,
    init: RequestInit & { auth?: boolean } = {}
  ): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('host', '127.0.0.1:31480')
    if (init.auth !== false) headers.set('authorization', `Bearer ${TOKEN}`)
    return app.fetch(
      new Request(`http://127.0.0.1:31480${path}`, { ...init, headers })
    )
  }
  const rpc = (body: unknown, auth = true): Promise<Response> =>
    call(ENGINE_HTTP.rpc, {
      method: 'POST',
      auth,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'yb-online-'))
    const config: ServerConfig = {
      host: '127.0.0.1',
      port: 0,
      dataDir: join(work, 'data'),
      cacheDir: join(work, 'data'),
      mediaRoots: [work],
      webDir: null,
      fetch: { kind: 'node' },
      monitor: { watchMode: 'off', scanIntervalMs: 0, settleMs: 0 },
    }
    app = await createServerApp(config, {
      log: () => {},
      codec: inProcessCodec(),
      watch: false,
      env: { YINGBOX_SERVER_TOKEN: TOKEN },
      engine,
    })
  })
  afterAll(async () => {
    await app.close()
    rmSync(work, { recursive: true, force: true })
  })

  it('rpc、事件流、播放代理都要令牌', async () => {
    expect(
      (await rpc({ channel: 'online:sites', args: [] }, false)).status
    ).toBe(401)
    expect((await call(ENGINE_HTTP.events, { auth: false })).status).toBe(401)
    expect(
      (
        await call(streamProxyPath('https://cdn.example.com/a.m3u8'), {
          auth: false,
        })
      ).status
    ).toBe(401)
  })

  it('rpc 转发到引擎，契约外的调用被拦下', async () => {
    const ok = (await (
      await rpc({ channel: 'online:sites', args: [] })
    ).json()) as EngineRpcResult
    expect(ok).toEqual({
      ok: true,
      value: { channel: 'online:sites', args: [] },
    })
    const denied = (await (
      await rpc({ channel: 'library:scan', args: [] })
    ).json()) as EngineRpcResult
    expect(denied.ok).toBe(false)
    expect((await rpc('nope')).status).toBe(400)
  })

  it('SSE 推契约里的事件，忽略别的通道', async () => {
    const controller = new AbortController()
    const response = await call(ENGINE_HTTP.events, {
      signal: controller.signal,
    })
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    await reader.read() // 连接注释
    engine.emit({ channel: 'secret:thing', payload: 1 })
    engine.emit({ channel: 'download:changed', payload: { queued: [] } })
    const { value } = await reader.read()
    expect(decoder.decode(value)).toBe(
      `data: ${JSON.stringify({ channel: 'download:changed', payload: { queued: [] } })}\n\n`
    )
    controller.abort()
    await reader.cancel()
  })

  it('播放代理挡下内网目标', async () => {
    const response = await call(
      streamProxyPath('http://127.0.0.1:31480/api/health')
    )
    expect(response.status).toBe(403)
  })
})

describe('child_process 引擎', () => {
  let dir: string
  let engine: ServerEngine
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'yb-engine-'))
    const config = loadOnlineConfig({}, dir)
    const entry = resolve(__dirname, '../../src/engine/node.ts')
    engine = createServerEngine({
      config,
      browser: createNodeBrowserFetch({
        spec: null,
        dataDir: dir,
        log: () => {},
      }),
      tmdbToken: () => '',
      log: () => {},
      fork: () =>
        wrapChild(
          fork(entry, [config.engineDir], {
            serialization: 'advanced',
            stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
            execArgv: ['--import', 'tsx'],
          })
        ),
    })
  })
  afterAll(async () => {
    await engine.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('经线协议调用引擎：站点表、下载队列、未配置令牌的 TMDB', async () => {
    const sites = (await engine.invoke('online:sites', [])) as unknown[]
    expect(sites.length).toBeGreaterThan(0)
    expect(await engine.invoke('download:list', [])).toEqual({
      queued: [],
      completed: [],
      failed: [],
    })
    expect(
      await engine.invoke('online:tmdb', ['/search/movie', { query: 'x' }])
    ).toBeNull()
    // 可选参数缺省（undefined）经结构化克隆原样到达引擎
    await expect(
      engine.invoke('online:resetBlocks', [undefined])
    ).resolves.toBeUndefined()
  }, 30_000)
})
