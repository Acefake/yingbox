import { describe, expect, it } from 'vitest'

import { fetchFirstOk } from '../src/shared/release/fetch-first'

describe('fetchFirstOk', () => {
  it('官方 200 时不请求镜像', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    const urls = [
      'https://api.github.com/repos/x/y/releases',
      'https://gh-proxy.com/https://api.github.com/repos/x/y/releases',
    ]
    await fetchFirstOk(urls, fetchImpl)
    expect(calls).toEqual([urls[0]])
  })

  it('官方网络失败后走镜像', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      if (calls.length === 1) throw new TypeError('fetch failed')
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    const urls = [
      'https://api.github.com/a',
      'https://gh-proxy.com/https://api.github.com/a',
    ]
    await fetchFirstOk(urls, fetchImpl)
    expect(calls).toEqual(urls)
  })

  it('404 不换源', async () => {
    const fetchImpl = (async () =>
      new Response('no', { status: 404 })) as typeof fetch
    await expect(
      fetchFirstOk(
        [
          'https://api.github.com/a',
          'https://gh-proxy.com/https://api.github.com/a',
        ],
        fetchImpl
      )
    ).rejects.toThrow(/404/)
  })

  it('空候选列表报错', async () => {
    await expect(fetchFirstOk([], fetch)).rejects.toThrow('没有可用的更新地址')
  })

  it('每次候选使用独立超时，官方超时后仍可请求镜像', async () => {
    const signals: AbortSignal[] = []
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      signals.push(init!.signal!)
      if (signals.length === 1)
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    await fetchFirstOk(
      [
        'https://api.github.com/a',
        'https://gh-proxy.com/https://api.github.com/a',
      ],
      fetchImpl,
      { timeoutMs: 1000 }
    )
    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
  })
})
