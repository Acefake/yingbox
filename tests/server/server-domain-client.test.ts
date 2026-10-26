/**
 * 网页端契约域 transport（services/server-domains/client.ts）：调用走 POST /api/domains/<域>/<方法>，
 * 失败抛人话；on<Key> 第一次订阅才开事件流，按域 + 事件分派，off<Key> 去掉该事件的回调，全退订后关流；
 * 事件流自己关掉后，resume() 或新订阅重新打开。
 */
import { type Mock, describe, expect, it, vi } from 'vitest'

import {
  createDomainClients,
  eventKeyOf,
} from '../../src/renderer/src/services/server-domains/client'

/** 测试夹具：记录请求，手动推送 / 关掉事件流。 */
interface Harness {
  clients: ReturnType<typeof createDomainClients>
  requests: Array<{ path: string; body: unknown }>
  openEvents: Mock<
    (
      url: string,
      onData: (data: string) => void,
      onClosed: () => void
    ) => { close: () => void }
  >
  close: Mock<() => void>
  push: (data: unknown) => void
  /** 模拟事件流自己关掉（服务没就绪时 EventSource 被关） */
  drop: () => void
}

function setup(reply: (path: string, body: unknown) => Response): Harness {
  const requests: Array<{ path: string; body: unknown }> = []
  let push: (data: string) => void = () => {}
  let drop: () => void = () => {}
  const close = vi.fn<() => void>()
  const openEvents = vi.fn(
    (_url: string, onData: (data: string) => void, onClosed: () => void) => {
      push = onData
      drop = onClosed
      return { close }
    }
  )
  const clients = createDomainClients({
    request: async (path, init) => {
      const body = JSON.parse(String(init.body))
      requests.push({ path, body })
      return reply(path, body)
    },
    openEvents,
  })
  return {
    clients,
    requests,
    openEvents,
    close,
    push: (d: unknown) => push(JSON.stringify(d)),
    drop: () => drop(),
  }
}

describe('createDomainClients', () => {
  it('方法调用 → POST，参数元组原样带上，成功返回 value', async () => {
    const { clients, requests } = setup(() =>
      Response.json({ ok: true, value: { loggedIn: false } })
    )
    const api = clients.domain('pan115')
    expect(await api.account()).toEqual({ loggedIn: false })
    await api.snap('https://115.com/s/abc', 'x1')
    expect(requests).toEqual([
      { path: '/api/domains/pan115/account', body: { args: [] } },
      {
        path: '/api/domains/pan115/snap',
        body: { args: ['https://115.com/s/abc', 'x1'] },
      },
    ])
    expect(clients.domain('pan115')).toBe(api)
  })

  it('失败结果、401、非 JSON 都抛出人话', async () => {
    const fail = setup(() =>
      Response.json({ ok: false, error: '片库服务没有启用 pan115' })
    )
    await expect(fail.clients.domain('pan115').account()).rejects.toThrow(
      '没有启用 pan115'
    )
    const unauthorized = setup(() =>
      Response.json({ error: '需要登录' }, { status: 401 })
    )
    await expect(unauthorized.clients.domain('x').y()).rejects.toThrow(
      '需要登录片库服务'
    )
    const html = setup(() => new Response('<html>', { status: 200 }))
    await expect(html.clients.domain('x').y()).rejects.toThrow('不是 JSON')
  })

  it('事件：首个订阅才开流，按域 + 事件分派，全退订后关流', () => {
    const { clients, openEvents, close, push } = setup(() =>
      Response.json({ ok: true, value: null })
    )
    const autograb = clients.domain('autograb')
    const movies = clients.domain('autograbMovies')
    expect(openEvents).not.toHaveBeenCalled()
    const a = vi.fn()
    const b = vi.fn()
    autograb.onChanged(a)
    movies.onChanged(b)
    expect(openEvents).toHaveBeenCalledTimes(1)
    push({ domain: 'autograb', event: 'changed', payload: null })
    expect(a).toHaveBeenCalledWith(undefined)
    expect(b).not.toHaveBeenCalled()
    autograb.offChanged()
    push({ domain: 'autograb', event: 'changed', payload: null })
    expect(a).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    movies.offChanged()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('事件流自己关掉后，服务恢复在线（resume）或新订阅会重新打开', () => {
    const { clients, openEvents, push, drop } = setup(() =>
      Response.json({ ok: true, value: null })
    )
    const autograb = clients.domain('autograb')
    const seen = vi.fn()
    autograb.onChanged(seen)
    expect(openEvents).toHaveBeenCalledTimes(1)
    drop()
    clients.resume()
    expect(openEvents).toHaveBeenCalledTimes(2)
    push({ domain: 'autograb', event: 'changed', payload: 3 })
    expect(seen).toHaveBeenCalledWith(3)
    drop()
    clients.domain('pan115').onStatus(() => {})
    expect(openEvents).toHaveBeenCalledTimes(3)
    autograb.offChanged()
    clients.domain('pan115').offStatus()
    drop()
    clients.resume()
    expect(openEvents).toHaveBeenCalledTimes(3)
  })

  it('then / toJSON / Vue 标记不是方法（不会被当成 thenable）', async () => {
    const { clients } = setup(() => Response.json({ ok: true, value: null }))
    const api = clients.domain('discover')
    expect((api as Record<string, unknown>).then).toBeUndefined()
    expect((api as Record<string, unknown>).__v_isRef).toBeUndefined()
    expect(await Promise.resolve(api)).toBe(api)
    expect(eventKeyOf('onStatus', 'on')).toBe('status')
    expect(eventKeyOf('once', 'on')).toBeNull()
    expect(eventKeyOf('offer', 'off')).toBeNull()
  })
})
