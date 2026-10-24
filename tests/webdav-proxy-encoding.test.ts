/**
 * 播放代理遇到压缩响应时的长度一致性：用真实本机 HTTP 服务和真实 fetch（会自动解压 gzip），
 * 验证转发后的响应头与正文对得上，Range 请求要的是原始字节。
 */
import { once } from 'node:events'
import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http'
import { type AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AccessLookup,
  createMpvProxy,
  forwardRemote,
} from '../src/main/webdav/proxy'

/** 8 KiB 的可压缩正文（压缩后远小于原长）。 */
const BODY = Buffer.from('yingbox-'.repeat(1024))
const GZIPPED = gzipSync(BODY)

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

/** 起一个本机上游，记录收到的请求头；返回 fetch 用的 lookup。 */
async function upstream(handler: Handler): Promise<{
  seen: IncomingHttpHeaders[]
  lookup: AccessLookup
}> {
  const seen: IncomingHttpHeaders[] = []
  const server = createServer((req, res) => {
    seen.push(req.headers)
    handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  closers.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  return {
    seen,
    lookup: async id =>
      id === 'ab12'
        ? { url: `http://127.0.0.1:${port}/dav`, username: '', password: '' }
        : null,
  }
}

/** 无视 Accept-Encoding、总回 gzip 的上游。 */
const alwaysGzip =
  (status = 200, extra: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(status, {
      'content-type': 'video/mp4',
      'content-encoding': 'gzip',
      'content-length': String(GZIPPED.length),
      'accept-ranges': 'bytes',
      ...extra,
    })
    res.end(GZIPPED)
  }

const target = { sourceId: 'ab12', path: '/a.mp4' }

describe('播放代理：压缩响应的长度一致性', () => {
  it('上游回 gzip 时，转发的头不带压缩长度，正文是完整解压内容', async () => {
    const { lookup, seen } = await upstream(alwaysGzip())
    const res = await forwardRemote(
      { method: 'GET', header: () => null },
      target,
      lookup,
      globalThis.fetch
    )
    expect(GZIPPED.length).toBeLessThan(BODY.length)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-range')).toBeNull()
    expect(res.headers.get('accept-ranges')).toBe('none')
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true)
    expect(seen[0]['accept-encoding']).toBe('identity')
  })

  it('Range 请求带 Accept-Encoding: identity，未压缩的 206 头与正文一致', async () => {
    const { lookup, seen } = await upstream((req, res) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(req.headers.range!)!
      const slice = BODY.subarray(Number(start), Number(end) + 1)
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${end}/${BODY.length}`,
        'accept-ranges': 'bytes',
      })
      res.end(slice)
    })
    const res = await forwardRemote(
      { method: 'GET', header: n => (n === 'range' ? 'bytes=100-199' : null) },
      target,
      lookup,
      globalThis.fetch
    )
    expect(seen[0].range).toBe('bytes=100-199')
    expect(seen[0]['accept-encoding']).toBe('identity')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.headers.get('content-range')).toBe(
      `bytes 100-199/${BODY.length}`
    )
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(BODY.subarray(100, 200))).toBe(true)
  })

  it('上游无视 identity 仍回压缩的 206：偏移对不上，回 502 不交错误字节', async () => {
    const { lookup } = await upstream(
      alwaysGzip(206, { 'content-range': `bytes 0-${GZIPPED.length - 1}/999` })
    )
    const res = await forwardRemote(
      { method: 'GET', header: n => (n === 'range' ? 'bytes=0-' : null) },
      target,
      lookup,
      globalThis.fetch
    )
    expect(res.status).toBe(502)
    expect(res.body).toBeNull()
  })

  it('mpv 本机代理：gzip 上游经代理后按解压正文完整读到', async () => {
    const { lookup } = await upstream(alwaysGzip())
    const proxy = createMpvProxy(lookup, globalThis.fetch)
    closers.push(() => proxy.close())
    const url = await proxy.urlFor('yingbox-dav://ab12/a.mp4')
    expect(url).not.toBeNull()
    const res = await globalThis.fetch(url!)
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true)
  })
})
