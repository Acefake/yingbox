import { once } from 'node:events'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { brotliCompressSync, gzipSync } from 'node:zlib'
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
      new Request(streamUrl('https://vt1.doubanio.com/seg.ts'), {
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
      'https://vt1.doubanio.com/seg.ts'
    )
    const headers = new Headers(fetch.mock.calls[0][1].headers)
    expect(headers.get('range')).toBe('bytes=1-3')
    expect(headers.get('referer')).toBe('https://movie.douban.com/')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
  })

  it.each([
    ['gzip', gzipSync],
    ['br', brotliCompressSync],
  ] as const)(
    '%s 解压后的流不携带上游压缩长度，清单内容完整',
    async (encoding, compress) => {
      const body = '#EXTM3U\n#EXTINF:5,\nsegment.ts\n'.repeat(64)
      const compressed = compress(Buffer.from(body))
      const server = createServer((_request, response) => {
        response.writeHead(200, {
          'content-type': 'application/vnd.apple.mpegurl',
          'content-encoding': encoding,
          'content-length': String(compressed.length),
        })
        response.end(compressed)
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const port = (server.address() as AddressInfo).port
      try {
        const handler = createStreamHandler(
          createNetClient({
            lookup,
            // 使用真实 fetch 读取本机压缩夹具，验证与 Chromium 相同的自动解压语义。
            fetch: (_url, init) =>
              fetch(`http://127.0.0.1:${port}/list.m3u8`, init),
          })
        )
        const response = await handler(
          new Request(streamUrl('https://cdn.test/list.m3u8'))
        )
        expect(compressed.length).not.toBe(Buffer.byteLength(body))
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(body)
        expect(response.headers.get('content-encoding')).toBeNull()
        expect(response.headers.get('content-length')).toBeNull()
        expect(response.headers.get('content-type')).toBe(
          'application/vnd.apple.mpegurl'
        )
      } finally {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    }
  )

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

describe('转发失败日志', () => {
  const tsUrl = 'https://cdn.example.com/live/seg.ts?token=secret'

  it('上游出错时记录主机与原因（不含地址里的令牌），并返回 502', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('net::ERR_CERT_DATE_INVALID')
    })
    const log = vi.fn()
    const handler = createStreamHandler(createNetClient({ lookup, fetch }), log)
    const response = await handler(new Request(streamUrl(tsUrl)))
    expect(response.status).toBe(502)
    expect(log).toHaveBeenCalledWith(tsUrl, 'net::ERR_CERT_DATE_INVALID')
  })

  it('上游 4xx/5xx 也记录状态码', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 403 }))
    const log = vi.fn()
    const handler = createStreamHandler(createNetClient({ lookup, fetch }), log)
    const response = await handler(new Request(streamUrl(tsUrl)))
    expect(response.status).toBe(403)
    expect(log).toHaveBeenCalledWith(tsUrl, 'HTTP 403')
  })

  it('默认日志只打主机，同一主机同一原因短时间内不重复', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () => new Response('no', { status: 404 }))
    const handler = createStreamHandler(createNetClient({ lookup, fetch }))
    await handler(new Request(streamUrl(tsUrl)))
    await handler(new Request(streamUrl(tsUrl)))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('[stream] cdn.example.com HTTP 404')
    warn.mockRestore()
  })
})
