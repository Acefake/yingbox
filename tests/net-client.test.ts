import { describe, expect, it, vi } from 'vitest'
import { type FetchImpl, createNetClient } from '../src/shared/net/client'

/** 只解析 internal.test 到内网，其余都是公网 */
const lookup = async (host: string): Promise<{ address: string }[]> => [
  { address: host === 'internal.test' ? '10.0.0.5' : '93.184.216.34' },
]

const text = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { status: 200, ...init })

describe('createNetClient', () => {
  it('手动跟随重定向，每一跳都过 SSRF 校验：302 指向内网被拒', async () => {
    const fetch = vi.fn<FetchImpl>(async url =>
      url === 'https://a.test/'
        ? new Response(null, {
            status: 302,
            headers: { location: 'http://internal.test/admin' },
          })
        : text('secret')
    )
    const net = createNetClient({ fetch, lookup })
    await expect(net.request('https://a.test/')).rejects.toThrow('内网')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('公网重定向被跟随，返回最终地址；303 把 POST 改成 GET', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) =>
      url === 'https://a.test/form'
        ? new Response(null, { status: 303, headers: { location: '/done' } })
        : text(`${init.method}`)
    )
    const net = createNetClient({ fetch, lookup })
    const res = await net.request('https://a.test/form', {
      method: 'POST',
      body: 'x=1',
    })
    expect(res.url).toBe('https://a.test/done')
    expect(new TextDecoder().decode(res.body)).toBe('GET')
  })

  it('超过大小上限即中止', async () => {
    const net = createNetClient({
      fetch: async () => text('x'.repeat(2048)),
      lookup,
    })
    await expect(
      net.request('https://a.test/', { maxBytes: 1024 })
    ).rejects.toThrow('大小限制')
  })

  it('超时中止请求', async () => {
    const fetch = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason)
        )
      })
    const net = createNetClient({ fetch, lookup })
    await expect(
      net.request('https://a.test/', { timeoutMs: 20 })
    ).rejects.toThrow()
  })

  it('allow 钩子可以收紧到指定主机', async () => {
    const net = createNetClient({ fetch: async () => text('ok'), lookup })
    await expect(
      net.request('https://other.test/', {
        allow: u => u.hostname === 'a.test',
      })
    ).rejects.toThrow('不允许访问')
  })

  it('同 URL 并发去重；ttl 内命中缓存，过期后重新请求', async () => {
    let clock = 0
    const fetch = vi.fn(async () => text('{"n":1}'))
    const net = createNetClient({ fetch, lookup, now: () => clock })
    const [a, b] = await Promise.all([
      net.getJson('https://a.test/x', { ttlMs: 1000 }),
      net.getJson('https://a.test/x', { ttlMs: 1000 }),
    ])
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 1 })
    expect(fetch).toHaveBeenCalledTimes(1)
    clock = 500
    await net.getJson('https://a.test/x', { ttlMs: 1000 })
    expect(fetch).toHaveBeenCalledTimes(1)
    clock = 1500
    await net.getJson('https://a.test/x', { ttlMs: 1000 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('非 2xx 的 getText 抛错且不缓存', async () => {
    const fetch = vi.fn(async () => text('no', { status: 500 }))
    const net = createNetClient({ fetch, lookup })
    await expect(
      net.getText('https://a.test/', { ttlMs: 1000 })
    ).rejects.toThrow('HTTP 500')
    await expect(
      net.getText('https://a.test/', { ttlMs: 1000 })
    ).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
