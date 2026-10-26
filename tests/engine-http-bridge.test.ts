/**
 * 网页端的引擎 transport（services/library-server/engine-bridge.ts）：按契约生成与 window.api 同形状的对象，
 * 调用走 HTTP RPC、错误带码，事件共用一条 SSE，没有订阅时关掉。
 */
import { describe, expect, it } from 'vitest'
import {
  type EngineBridge,
  createEngineBridge,
} from '../src/renderer/src/services/library-server/engine-bridge'
import { download } from '../src/shared/contract/download'
import { online } from '../src/shared/contract/online'
import { ENGINE_HTTP } from '../src/shared/engine-http'

interface Sent {
  path: string
  body: { channel: string; args: unknown[]; undefinedAt?: number[] }
}
interface FakeStream {
  url: string
  push: (data: string) => void
  /** 模拟事件流自己关掉（服务不在线时不再重连） */
  drop: () => void
  closed: boolean
}

function setup(respond: (body: Sent['body']) => Response): {
  bridge: EngineBridge
  requests: Sent[]
  streams: FakeStream[]
} {
  const requests: Sent[] = []
  const streams: FakeStream[] = []
  const bridge = createEngineBridge({
    request: async (path, init) => {
      const body = JSON.parse(String(init.body)) as Sent['body']
      requests.push({ path, body })
      return respond(body)
    },
    openEvents: (url, onData, onClosed) => {
      const stream: FakeStream = {
        url,
        push: onData,
        drop: () => {
          stream.closed = true
          onClosed()
        },
        closed: false,
      }
      streams.push(stream)
      return { close: () => void (stream.closed = true) }
    },
  })
  return { bridge, requests, streams }
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('createEngineBridge', () => {
  it('调用：通道名 + 参数元组原样发出，结果原样返回', async () => {
    const { bridge, requests } = setup(body =>
      json({ ok: true, value: body.args })
    )
    const api = bridge.api(online)
    expect(await api.doubanTrailer('42', 'tv')).toEqual(['42', 'tv'])
    expect(requests[0]).toEqual({
      path: ENGINE_HTTP.rpc,
      body: { channel: 'online:doubanTrailer', args: ['42', 'tv'] },
    })
  })

  it('失败：引擎错误带码，HTTP 错误给人看的原因', async () => {
    const { bridge } = setup(() =>
      json({
        ok: false,
        error: { code: 'invalid-params', message: '参数不对' },
      })
    )
    await expect(bridge.api(online).sites()).rejects.toMatchObject({
      message: '参数不对',
      code: 'invalid-params',
    })
    const missing = setup(() => new Response('nope', { status: 404 }))
    await expect(missing.bridge.api(online).sites()).rejects.toThrow(
      /没有开启在线板块/
    )
    const login = setup(() => new Response('', { status: 401 }))
    await expect(login.bridge.api(online).sites()).rejects.toThrow(/需要登录/)
  })

  it('事件：一条 SSE 共用，off 退订该事件，全部退订后关闭', () => {
    const { bridge, streams } = setup(() => json({ ok: true, value: null }))
    const api = bridge.api(download)
    const seen: unknown[] = []
    api.onChanged(payload => seen.push(payload))
    api.onChanged(payload => seen.push(['second', payload]))
    expect(streams).toHaveLength(1)
    expect(streams[0].url).toBe(ENGINE_HTTP.events)
    streams[0].push(JSON.stringify({ channel: 'download:changed', payload: 1 }))
    streams[0].push(JSON.stringify({ channel: 'online:other', payload: 2 }))
    streams[0].push('not json')
    expect(seen).toEqual([1, ['second', 1]])
    api.offChanged()
    expect(streams[0].closed).toBe(true)
  })

  it('undefined 参数单独标出下标，JSON 里只留 null 占位', async () => {
    const { bridge, requests } = setup(() => json({ ok: true, value: null }))
    await bridge.api(online).doubanTrailer('42', undefined)
    expect(requests[0].body).toEqual({
      channel: 'online:doubanTrailer',
      args: ['42', null],
      undefinedAt: [1],
    })
  })

  it('事件流自己关掉后，服务恢复在线（resume）或新订阅会重新打开', () => {
    const { bridge, streams } = setup(() => json({ ok: true, value: null }))
    const api = bridge.api(download)
    const seen: unknown[] = []
    api.onChanged(payload => seen.push(payload))
    streams[0].drop()
    bridge.resume()
    expect(streams).toHaveLength(2)
    streams[1].push(JSON.stringify({ channel: 'download:changed', payload: 3 }))
    expect(seen).toEqual([3])
    streams[1].drop()
    api.onChanged(() => {})
    expect(streams).toHaveLength(3)
    api.offChanged()
    bridge.resume()
    expect(streams).toHaveLength(3)
  })
})
