/**
 * 网页端片库 transport：RPC 线格式、错误码编码（与 preload 一致）、HTTP 失败、单条 SSE 共享与退订。
 */
import { describe, expect, it } from 'vitest'
import {
  type InvokeResult,
  type LibraryEvent,
  libraryErrorCode,
} from '../../../src/shared/library/ipc'
import { createHttpLibraryBridge } from '../../../src/renderer/src/features/library/api/http-bridge'

/** 测试夹具：记录请求、手动推送事件。 */
interface Harness {
  bridge: ReturnType<typeof createHttpLibraryBridge>
  calls: Array<{ path: string; body: { method: string; params: unknown } }>
  streams: Array<{ url: string; push: (data: string) => void; closed: boolean }>
}

function harness(
  reply: (body: {
    method: string
    params: unknown
  }) => Response | Promise<Response>
): Harness {
  const calls: Array<{
    path: string
    body: { method: string; params: unknown }
  }> = []
  const streams: Array<{
    url: string
    push: (data: string) => void
    closed: boolean
  }> = []
  const bridge = createHttpLibraryBridge({
    request: async (path, init) => {
      const body = JSON.parse(String(init.body))
      calls.push({ path, body })
      return reply(body)
    },
    openEvents: (url, onData) => {
      const stream = { url, push: onData, closed: false }
      streams.push(stream)
      return { close: () => (stream.closed = true) }
    },
  })
  return { bridge, calls, streams }
}

const ok = (result: unknown): Response =>
  Response.json({ ok: true, result } satisfies InvokeResult)

describe('createHttpLibraryBridge', () => {
  it('方法与参数原样走 POST /api/library/rpc', async () => {
    const { bridge, calls } = harness(() => ok([]))
    await bridge.listLibraries()
    await bridge.getItem(7)
    await bridge.writer.write([1, 2])
    await bridge.setProviderToken!(null)
    expect(calls).toEqual([
      { path: '/api/library/rpc', body: { method: 'listLibraries' } },
      {
        path: '/api/library/rpc',
        body: { method: 'getItem', params: { itemId: 7 } },
      },
      {
        path: '/api/library/rpc',
        body: { method: 'writer.write', params: { itemIds: [1, 2] } },
      },
      {
        path: '/api/library/rpc',
        body: {
          method: 'setProviderToken',
          params: { provider: 'tmdb', token: null },
        },
      },
    ])
  })

  it('引擎错误保留错误码；HTTP 401 / 网络错误变成 engine-unavailable', async () => {
    const failing = harness(() =>
      Response.json({
        ok: false,
        error: { code: 'not-found', message: '没有这个条目' },
      })
    )
    const error = await failing.bridge.getItem(1).catch(e => e)
    expect(libraryErrorCode(error)).toBe('not-found')
    expect(error.message).toContain('没有这个条目')

    const unauthorized = harness(
      () => new Response('需要登录', { status: 401 })
    )
    const denied = await unauthorized.bridge.listLibraries().catch(e => e)
    expect(libraryErrorCode(denied)).toBe('engine-unavailable')
    expect(denied.message).toContain('需要登录')

    const offline = harness(() => Promise.reject(new TypeError('fetch failed')))
    expect(
      libraryErrorCode(await offline.bridge.listLibraries().catch(e => e))
    ).toBe('engine-unavailable')
  })

  it('多个订阅方共用一条 SSE，最后一个退订时关闭', () => {
    const { bridge, streams } = harness(() => ok(null))
    const a: LibraryEvent[] = []
    const b: LibraryEvent[] = []
    const offA = bridge.subscribe(event => a.push(event))
    const offB = bridge.subscribe(event => b.push(event))
    expect(streams).toHaveLength(1)
    expect(streams[0].url).toBe('/api/library/events')
    streams[0].push(
      JSON.stringify({ type: 'libraries-changed', libraries: [] })
    )
    streams[0].push('not json')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    offA()
    expect(streams[0].closed).toBe(false)
    offB()
    expect(streams[0].closed).toBe(true)
    bridge.subscribe(() => {})
    expect(streams).toHaveLength(2)
  })
})
