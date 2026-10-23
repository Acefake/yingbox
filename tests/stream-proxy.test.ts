import { describe, expect, it, vi } from 'vitest'
import { createStreamHandler } from '../src/main/stream-proxy'
import { createNetClient } from '../src/shared/net/client'
import { STREAM_RESPONSE_URL, streamUrl } from '../src/shared/stream-url'

const lookup = async (): Promise<Array<{ address: string }>> => [
  { address: '93.184.216.34' },
]

describe('桌面 HLS 公网传输', () => {
  it('保留 Range 和最终清单地址，不向远端转发 Cookie、认证头，也不向页面返回 Set-Cookie', async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('BCD', {
          status: 206,
          headers: {
            'content-range': 'bytes 1-3/6',
            'set-cookie': 'secret=x',
            'content-type': 'video/mp2t',
          },
        })
    )
    const handler = createStreamHandler(createNetClient({ lookup, fetch }))
    const response = await handler(
      new Request(streamUrl('https://surrit.com/seg.ts'), {
        headers: {
          range: 'bytes=1-3',
          cookie: 'private=x',
          authorization: 'Bearer private',
        },
      })
    )
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('BCD')
    expect(response.headers.get('content-range')).toBe('bytes 1-3/6')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get(STREAM_RESPONSE_URL)).toBe(
      'https://surrit.com/seg.ts'
    )
    const headers = new Headers(fetch.mock.calls[0][1].headers)
    expect(headers.get('range')).toBe('bytes=1-3')
    expect(headers.get('referer')).toBe('https://missav.ai/')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
  })

  it('内网、DNS 内网记录和重定向到内网都被拦截', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        })
    )
    const handler = createStreamHandler(
      createNetClient({
        lookup: async host =>
          host === 'internal.test' ? [{ address: '10.0.0.1' }] : lookup(),
        fetch,
      })
    )
    for (const url of [
      'http://127.0.0.1/private',
      'http://internal.test/private',
    ]) {
      expect((await handler(new Request(streamUrl(url)))).status).toBe(502)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(
      (await handler(new Request(streamUrl('https://cdn.test/list.m3u8'))))
        .status
    ).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('拒绝凭据、非 HTTP(S)、非读取方法与错误的协议路径', async () => {
    expect(() => streamUrl('file:///etc/passwd')).toThrow()
    expect(() => streamUrl('https://user:pass@cdn.test/a')).toThrow()
    const fetch = vi.fn()
    const handler = createStreamHandler(createNetClient({ lookup, fetch }))
    expect(
      (
        await handler(
          new Request(streamUrl('https://cdn.test/a'), { method: 'POST' })
        )
      ).status
    ).toBe(405)
    expect((await handler(new Request('yingbox-stream://wrong/'))).status).toBe(
      400
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
