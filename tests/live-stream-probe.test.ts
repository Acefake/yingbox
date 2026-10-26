/**
 * 直播线路探测（src/main/iptv/stream-probe.ts）与播放代理的连接超时（src/main/stream-proxy.ts），
 * 用本机起的 HTTP 服务模拟 IPTV 源：不回 CORS 头、302 到相对路径、永不结束的 FLV / TS 流、只连不回、404。
 * 出网客户端用真实 fetch，域名解析注入成公网地址，请求改写到本机端口（SSRF 校验照常生效）。
 */
import { once } from 'node:events'
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { probeStream } from '../src/main/iptv/stream-probe'
import {
  STREAM_ERROR_HEADER,
  createStreamHandler,
} from '../src/main/stream-proxy'
import { createNetClient } from '../src/shared/net/client'
import { STREAM_RESPONSE_URL, streamUrl } from '../src/shared/stream-url'

const FLV_HEADER = Buffer.from([0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9])
const tsPacket = Buffer.from(
  Uint8Array.from({ length: 188 }, (_, i) => (i === 0 ? 0x47 : 0xff))
)

/** 永不结束的流：每 50 ms 写一块，直到客户端断开 */
function endless(
  res: ServerResponse,
  type: string,
  first: Buffer,
  chunk: Buffer
): void {
  res.writeHead(200, { 'content-type': type })
  res.write(first)
  const timer = setInterval(() => res.write(chunk), 50)
  res.on('close', () => clearInterval(timer))
}

function route(req: IncomingMessage, res: ServerResponse): void {
  const path = req.url ?? '/'
  if (path === '/live.m3u8') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg-1.ts\n')
  } else if (path === '/api?id=cctv1') {
    res.writeHead(302, { location: '/hls/real/index.m3u8?token=abc' })
    res.end()
  } else if (path.startsWith('/hls/real/index.m3u8')) {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
    res.end('#EXTM3U\n#EXTINF:4,\nseg.ts\n')
  } else if (path === '/huya/1') {
    res.writeHead(302, { location: '/src/stream.flv' })
    res.end()
  } else if (path === '/src/stream.flv') {
    endless(res, 'application/octet-stream', FLV_HEADER, Buffer.alloc(4096, 1))
  } else if (path === '/rtp/239.3.1.241:8000') {
    endless(
      res,
      'application/octet-stream',
      Buffer.concat([tsPacket, tsPacket]),
      tsPacket
    )
  } else if (path === '/hang') {
    // 只建立连接，不回响应头
  } else if (path === '/slow-body') {
    // 响应头立即返回，响应体持续时间超过连接超时
    res.writeHead(200, { 'content-type': 'video/mp2t' })
    let n = 0
    const timer = setInterval(() => {
      res.write(tsPacket)
      if (++n === 8) {
        clearInterval(timer)
        res.end()
      }
    }, 50)
    res.on('close', () => clearInterval(timer))
  } else if (path === '/page') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!DOCTYPE html><html><body>blocked</body></html>')
  } else {
    res.writeHead(404)
    res.end('no')
  }
}

const server = createServer(route)
let port = 0
const ORIGIN = 'http://iptv.test'

/** 真实 fetch，主机改写到本机端口；域名解析成公网地址 */
const net = createNetClient({
  lookup: async host =>
    host === 'internal.test'
      ? [{ address: '192.168.1.5' }]
      : [{ address: '93.184.216.34' }],
  fetch: (url, init) => {
    const target = new URL(url)
    target.protocol = 'http:'
    target.host = `127.0.0.1:${port}`
    return fetch(target, init)
  },
})

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('直播线路探测', () => {
  it('Content-Type 写错的 m3u8 按内容认成 HLS', async () => {
    const result = await probeStream(net, `${ORIGIN}/live.m3u8`)
    expect(result).toMatchObject({ ok: true, kind: 'hls', status: 200 })
  })

  it('302 到相对路径：跟随重定向并给出最终地址', async () => {
    const result = await probeStream(net, `${ORIGIN}/api?id=cctv1`)
    expect(result).toMatchObject({
      ok: true,
      kind: 'hls',
      finalUrl: `${ORIGIN}/hls/real/index.m3u8?token=abc`,
    })
  })

  it('重定向到永不结束的 FLV 流：读到开头就断开，认成 FLV', async () => {
    const started = Date.now()
    const result = await probeStream(net, `${ORIGIN}/huya/1`, { readMs: 2000 })
    expect(result).toMatchObject({ ok: true, kind: 'flv' })
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('组播网关的连续 TS 认成 MPEG-TS', async () => {
    const result = await probeStream(net, `${ORIGIN}/rtp/239.3.1.241:8000`, {
      readMs: 2000,
    })
    expect(result).toMatchObject({ ok: true, kind: 'mpegts' })
  })

  it('只连不回响应头：按连接超时失败', async () => {
    const started = Date.now()
    const result = await probeStream(net, `${ORIGIN}/hang`, { connectMs: 300 })
    expect(result).toMatchObject({ ok: false, failure: 'timeout' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('404 带状态码失败；网页认成 html', async () => {
    expect(await probeStream(net, `${ORIGIN}/gone.m3u8`)).toMatchObject({
      ok: false,
      failure: 'http',
      status: 404,
    })
    expect(await probeStream(net, `${ORIGIN}/page`)).toMatchObject({
      ok: true,
      kind: 'html',
    })
  })

  it('内网地址与解析到内网的域名被拦下，标为 blocked', async () => {
    expect(await probeStream(net, 'http://192.168.1.1/a.m3u8')).toMatchObject({
      ok: false,
      failure: 'blocked',
    })
    expect(await probeStream(net, 'http://internal.test/a.m3u8')).toMatchObject(
      { ok: false, failure: 'blocked' }
    )
  })

  it('rtmp / rtp 等协议不发请求，直接判为外部格式', async () => {
    expect(await probeStream(net, 'rtmp://a/live/1')).toMatchObject({
      ok: true,
      kind: 'mpegts',
    })
    expect(await probeStream(net, 'rtmp://a/x.flv')).toMatchObject({
      ok: true,
      kind: 'flv',
    })
  })
})

describe('播放代理（无 CORS 头的 IPTV 源）', () => {
  const handler = createStreamHandler(net, () => {}, 300)

  it('转发清单并补上 CORS 头与最终地址（hls.js 据此解析相对分片）', async () => {
    const response = await handler(
      new Request(streamUrl(`${ORIGIN}/api?id=cctv1`))
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get(STREAM_RESPONSE_URL)).toBe(
      `${ORIGIN}/hls/real/index.m3u8?token=abc`
    )
    expect(await response.text()).toContain('#EXTM3U')
  })

  it('等不到响应头回 504，并在响应头里写明原因', async () => {
    const response = await handler(new Request(streamUrl(`${ORIGIN}/hang`)))
    expect(response.status).toBe(504)
    expect(
      decodeURIComponent(response.headers.get(STREAM_ERROR_HEADER) ?? '')
    ).toBe('连接超时')
  })

  it('响应头按时到了，响应体传得比连接超时久也不会被掐断', async () => {
    const response = await handler(
      new Request(streamUrl(`${ORIGIN}/slow-body`))
    )
    expect(response.status).toBe(200)
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body.byteLength).toBe(188 * 8)
  })
})
