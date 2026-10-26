/**
 * 独立服务的播放代理（/api/stream）：SSRF（协议 / 凭据 / 内网 / 重定向到内网 / 显式放行）、
 * 按源注入 Referer、Range 透传、m3u8 改写（分片、密钥、子清单都走代理），非清单原样流式转发。
 */
import { describe, expect, it } from 'vitest'
import { createStreamProxy } from '../../src/server/online/stream/route'
import {
  looksLikePlaylist,
  mayBePlaylist,
  rewritePlaylist,
} from '../../src/server/online/stream/m3u8'
import { createStreamGuard } from '../../src/server/online/stream/guard'
import { streamProxyPath } from '../../src/shared/engine-http'

const PUBLIC = [{ address: '93.184.216.34' }]
const lookup = async (host: string): Promise<Array<{ address: string }>> =>
  host === 'nas.lan' || host === 'evil.example'
    ? [{ address: '192.168.1.20' }]
    : PUBLIC

interface Seen {
  url: string
  headers: Headers
}

/** 假上游：按地址回固定响应，记录收到的请求头。 */
function upstream(routes: Record<string, () => Response>): {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  seen: Seen[]
} {
  const seen: Seen[] = []
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({ url, headers: new Headers(init.headers) })
      const route = routes[url]
      return route ? route() : new Response('nope', { status: 404 })
    },
  }
}

const proxyFor = (
  routes: Record<string, () => Response>,
  allowPrivate: string[] = []
): {
  get: (src: string, headers?: Record<string, string>) => Promise<Response>
  seen: Seen[]
} => {
  const up = upstream(routes)
  const proxy = createStreamProxy({
    allowPrivate,
    fetch: up.fetch,
    lookup,
    logFailure: () => {},
  })
  const get = (
    src: string,
    headers: Record<string, string> = {}
  ): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:31480${streamProxyPath(src)}`)
    return proxy(new Request(url, { headers }), url)
  }
  return { get, seen: up.seen }
}

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000',
  'hd/index.m3u8',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/a.m3u8"',
].join('\n')

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-KEY:METHOD=AES-128,URI="/keys/k.bin",IV=0x1',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:6,',
  'seg-1.ts',
  '#EXTINF:6,',
  'https://cdn2.example.com/seg-2.ts?t=1',
  '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay"',
  '',
].join('\n')

describe('m3u8 改写', () => {
  it('地址行与 URI= 属性都换成代理地址，相对地址按清单地址解析，非 http(s) 不动', () => {
    const out = rewritePlaylist(
      MEDIA,
      'https://cdn.example.com/v/index.m3u8',
      streamProxyPath
    )
    const wrap = (u: string): string => streamProxyPath(u)
    expect(out).toContain(`URI="${wrap('https://cdn.example.com/keys/k.bin')}"`)
    expect(out).toContain(`URI="${wrap('https://cdn.example.com/v/init.mp4')}"`)
    expect(out).toContain(wrap('https://cdn.example.com/v/seg-1.ts'))
    expect(out).toContain(wrap('https://cdn2.example.com/seg-2.ts?t=1'))
    expect(out).toContain('URI="skd://fairplay"')
    expect(out).toContain('#EXTINF:6,')
  })

  it('认清单靠正文开头；音视频类型不嗅探', () => {
    expect(looksLikePlaylist('\uFEFF  #EXTM3U\n')).toBe(true)
    expect(looksLikePlaylist('<html>')).toBe(false)
    expect(mayBePlaylist('application/vnd.apple.mpegurl')).toBe(true)
    expect(mayBePlaylist('text/plain')).toBe(true)
    expect(mayBePlaylist('')).toBe(true)
    expect(mayBePlaylist('video/mp2t')).toBe(false)
    expect(mayBePlaylist('video/mp4')).toBe(false)
  })
})

describe('播放代理', () => {
  it('拒绝非 http(s)、带凭据、内网与回环目标（403），不发请求', async () => {
    const { get, seen } = proxyFor({})
    for (const src of [
      'file:///etc/passwd',
      'ftp://example.com/a.ts',
      'http://user:pw@example.com/a.ts',
      'http://127.0.0.1:31480/api/health',
      'http://10.0.0.5/a.m3u8',
      'http://[::1]/a.m3u8',
      'http://localhost/a.m3u8',
      'http://evil.example/a.m3u8',
      '',
    ]) {
      const response = await get(src)
      expect(response.status, src).toBe(403)
    }
    expect(seen).toEqual([])
  })

  it('重定向到内网时中止（每一跳都校验）', async () => {
    const { get } = proxyFor({
      'https://cdn.example.com/a.mp4': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://192.168.1.1/admin' },
        }),
    })
    const response = await get('https://cdn.example.com/a.mp4')
    expect(response.status).toBe(502)
    expect(
      decodeURIComponent(response.headers.get('x-yingbox-error') ?? '')
    ).toMatch(/内网/)
  })

  it('显式放行的内网主机 / 网段可以访问', async () => {
    const ok = (): Response =>
      new Response('x', { headers: { 'content-type': 'video/mp4' } })
    const { get } = proxyFor(
      {
        'http://nas.lan/a.mp4': ok,
        'http://192.168.1.30/b.mp4': ok,
      },
      ['192.168.1.0/24']
    )
    expect((await get('http://nas.lan/a.mp4')).status).toBe(200)
    expect((await get('http://192.168.1.30/b.mp4')).status).toBe(200)
    expect((await get('http://10.0.0.1/c.mp4')).status).toBe(403)
    const guard = createStreamGuard(['nas.lan'])
    await expect(guard('http://nas.lan/x', lookup)).resolves.toBeInstanceOf(URL)
  })

  it('透传 Range，按源注入 Referer 与默认 UA，不带 Cookie', async () => {
    const { get, seen } = proxyFor({
      'https://surrit.com/v/seg.ts': () =>
        new Response('abc', {
          status: 206,
          headers: {
            'content-type': 'video/mp2t',
            'content-range': 'bytes 0-2/100',
          },
        }),
    })
    const response = await get('https://surrit.com/v/seg.ts', {
      range: 'bytes=0-2',
      cookie: 'yingbox_token=secret',
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-2/100')
    expect(await response.text()).toBe('abc')
    expect(seen[0].headers.get('range')).toBe('bytes=0-2')
    expect(seen[0].headers.get('referer')).toBe('https://missav.ai/')
    expect(seen[0].headers.get('user-agent')).toMatch(/Chrome/)
    expect(seen[0].headers.get('cookie')).toBeNull()
  })

  it('清单改写成经代理取，基准是跟随重定向后的地址；类型不对也认得出', async () => {
    const { get } = proxyFor({
      'https://site.example.com/play?id=1': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/v/index.m3u8' },
        }),
      'https://cdn.example.com/v/index.m3u8': () =>
        new Response(MASTER, { headers: { 'content-type': 'text/plain' } }),
    })
    const response = await get('https://site.example.com/play?id=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.apple.mpegurl'
    )
    const text = await response.text()
    expect(text).toContain(
      streamProxyPath('https://cdn.example.com/v/hd/index.m3u8')
    )
    expect(text).toContain(
      `URI="${streamProxyPath('https://cdn.example.com/v/audio/a.m3u8')}"`
    )
  })

  it('非清单正文原样流式转发', async () => {
    const body = new Uint8Array(200_000).fill(7)
    const { get } = proxyFor({
      'https://cdn.example.com/file.bin': () =>
        new Response(body, {
          headers: { 'content-type': 'application/octet-stream' },
        }),
    })
    const response = await get('https://cdn.example.com/file.bin')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBe(body.byteLength)
    expect(bytes[199_999]).toBe(7)
  })

  it('上游回网页时不在服务的源上执行：nosniff + CSP sandbox，清单改写后也保留', async () => {
    const { get } = proxyFor({
      'https://evil.cdn.example/x.html': () =>
        new Response('<script>fetch("/api/library/rpc")</script>', {
          headers: { 'content-type': 'text/html' },
        }),
      'https://cdn.example.com/live.m3u8': () =>
        new Response('#EXTM3U\n#EXTINF:4,\na.ts\n'),
    })
    for (const src of [
      'https://evil.cdn.example/x.html',
      'https://cdn.example.com/live.m3u8',
    ]) {
      const response = await get(src)
      expect(response.status).toBe(200)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-security-policy')).toMatch(
        /^sandbox/
      )
    }
  })

  it('开头被拆成很小的块也认得出清单；改写后不带上游的 Content-Length', async () => {
    const bytes = new TextEncoder().encode(MEDIA)
    const tiny = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 3)
              controller.enqueue(bytes.subarray(i, i + 3))
            controller.close()
          },
        }),
        {
          headers: {
            'content-type': 'text/plain',
            'content-length': String(bytes.length),
          },
        }
      )
    const { get } = proxyFor({ 'https://cdn.example.com/v/a.m3u8': tiny })
    const response = await get('https://cdn.example.com/v/a.m3u8')
    const text = await response.text()
    expect(text).toContain(
      streamProxyPath('https://cdn.example.com/v/seg-1.ts')
    )
    const length = response.headers.get('content-length')
    if (length !== null)
      expect(Number(length)).toBe(new TextEncoder().encode(text).byteLength)
  })

  it('不足嗅探长度就结束的非清单正文原样返回', async () => {
    const { get } = proxyFor({
      'https://cdn.example.com/short.txt': () =>
        new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    })
    expect(await (await get('https://cdn.example.com/short.txt')).text()).toBe(
      'ok'
    )
  })
})
