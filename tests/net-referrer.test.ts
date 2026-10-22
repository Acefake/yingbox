import { describe, expect, it, vi } from 'vitest'
import { type FetchImpl, createNetClient } from '../src/shared/net/client'
import { withExplicitReferrer } from '../src/shared/net/referrer'

const lookup = async (): Promise<{ address: string }[]> => [
  { address: '93.184.216.34' },
]

describe('withExplicitReferrer', () => {
  it('带 Referer（任意大小写）时补 unsafe-url，否则 Electron 会以 ERR_BLOCKED_BY_CLIENT 取消请求', () => {
    expect(
      withExplicitReferrer({ headers: { referer: 'https://a.test/' } })
    ).toMatchObject({ referrerPolicy: 'unsafe-url' })
    expect(
      withExplicitReferrer({ headers: [['Referer', 'https://a.test/']] })
    ).toMatchObject({ referrerPolicy: 'unsafe-url' })
  })

  it('没有 Referer 或已显式指定策略时原样返回', () => {
    const plain = { headers: { Accept: '*/*' } }
    expect(withExplicitReferrer(plain)).toBe(plain)
    const explicit: RequestInit = {
      headers: { Referer: 'https://a.test/' },
      referrerPolicy: 'no-referrer',
    }
    expect(withExplicitReferrer(explicit)).toBe(explicit)
    expect(withExplicitReferrer()).toEqual({})
  })
})

describe('createNetClient 的 Referer', () => {
  it('带 Referer 的请求交给宿主 fetch 时带上 referrerPolicy: unsafe-url', async () => {
    const fetch = vi.fn<FetchImpl>(async () => new Response('{"items":[]}'))
    const net = createNetClient({ fetch, lookup })
    await net.getJson('https://m.douban.test/rexxar', {
      headers: { Referer: 'https://movie.douban.test/explore' },
    })
    expect(fetch.mock.calls[0][1]).toMatchObject({
      referrerPolicy: 'unsafe-url',
    })
  })

  it('不带 Referer 的请求不设 referrerPolicy', async () => {
    const fetch = vi.fn<FetchImpl>(async () => new Response('ok'))
    const net = createNetClient({ fetch, lookup })
    await net.getText('https://a.test/')
    expect(fetch.mock.calls[0][1].referrerPolicy).toBeUndefined()
  })
})
