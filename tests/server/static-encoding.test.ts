/**
 * 静态文件预压缩：按 Accept-Encoding 选 .br / .gz，回退原文，大文件流式读。
 */
import { brotliCompressSync, gzipSync } from 'node:zlib'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  STATIC_STREAM_ABOVE,
  createStaticHandler,
} from '../../src/server/http/static'

const dirs: string[] = []

/** 网页根在临时目录的子文件夹里，穿越用的邻文件也留在这次的临时目录内。 */
function webDir(): string {
  const parent = mkdtempSync(join(tmpdir(), 'yingbox-static-'))
  dirs.push(parent)
  const dir = join(parent, 'web')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://nas${path}`, { headers })
}

describe('预压缩静态文件', () => {
  it('按质量值选 br，Content-Type 仍按原文件，并带 Vary', async () => {
    const dir = webDir()
    const raw = 'const player = "artplayer hls danmaku";'.repeat(40)
    writeFileSync(join(dir, 'assets/app.js'), raw)
    writeFileSync(join(dir, 'assets/app.js.br'), brotliCompressSync(raw))
    writeFileSync(join(dir, 'assets/app.js.gz'), gzipSync(raw))
    const handler = createStaticHandler(dir)

    const res = await handler(
      request('/assets/app.js', { 'accept-encoding': 'gzip;q=0.5, br;q=1' }),
      new URL('http://nas/assets/app.js')
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('content-length')).toBe(
      String(brotliCompressSync(raw).length)
    )
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      brotliCompressSync(raw)
    )
  })

  it('br 质量更低或文件不存在时用 gzip，都不接受时回原文', async () => {
    const dir = webDir()
    const raw = 'hello-static-body'
    writeFileSync(join(dir, 'assets/app.js'), raw)
    writeFileSync(join(dir, 'assets/app.js.gz'), gzipSync(raw))
    const handler = createStaticHandler(dir)

    const gzip = await handler(
      request('/assets/app.js', { 'accept-encoding': 'br;q=0.1, gzip;q=0.9' }),
      new URL('http://nas/assets/app.js')
    )
    expect(gzip.headers.get('content-encoding')).toBe('gzip')
    expect(Buffer.from(await gzip.arrayBuffer())).toEqual(gzipSync(raw))

    const identity = await handler(
      request('/assets/app.js', { 'accept-encoding': 'identity' }),
      new URL('http://nas/assets/app.js')
    )
    expect(identity.headers.get('content-encoding')).toBeNull()
    expect(await identity.text()).toBe(raw)
    expect(identity.headers.get('content-length')).toBe(String(raw.length))
  })

  it('没有预压缩文件、没有 Accept-Encoding 时回原文', async () => {
    const dir = webDir()
    writeFileSync(join(dir, 'assets/app.js'), 'plain')
    const handler = createStaticHandler(dir)
    const res = await handler(
      request('/assets/app.js'),
      new URL('http://nas/assets/app.js')
    )
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe('plain')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
  })

  it('ETag 对应该次实际返回的文件，编码不同不能 304', async () => {
    const dir = webDir()
    const raw = 'etag-body-etag-body'
    writeFileSync(join(dir, 'assets/app.js'), raw)
    writeFileSync(join(dir, 'assets/app.js.br'), brotliCompressSync(raw))
    const handler = createStaticHandler(dir)
    const url = new URL('http://nas/assets/app.js')
    const first = await handler(
      request('/assets/app.js', { 'accept-encoding': 'br' }),
      url
    )
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    const cached = await handler(
      request('/assets/app.js', {
        'accept-encoding': 'br',
        'if-none-match': etag ?? '',
      }),
      url
    )
    expect(cached.status).toBe(304)
    expect(cached.headers.get('vary')).toBe('Accept-Encoding')
    expect(cached.body).toBeNull()

    const other = await handler(
      request('/assets/app.js', {
        'accept-encoding': 'identity',
        'if-none-match': etag ?? '',
      }),
      url
    )
    expect(other.status).toBe(200)
    expect(await other.text()).toBe(raw)
  })

  it('HEAD 不带正文，但长度和编码与 GET 一致', async () => {
    const dir = webDir()
    const raw = 'head-body'
    writeFileSync(join(dir, 'assets/app.js.gz'), gzipSync(raw))
    writeFileSync(join(dir, 'assets/app.js'), raw)
    const handler = createStaticHandler(dir)
    const res = await handler(
      new Request('http://nas/assets/app.js', {
        method: 'HEAD',
        headers: { 'accept-encoding': 'gzip' },
      }),
      new URL('http://nas/assets/app.js')
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('content-length')).toBe(String(gzipSync(raw).length))
    expect(res.body).toBeNull()
  })

  it('大文件内容完整，非 assets 仍是 no-cache，穿越落回 index.html', async () => {
    const dir = webDir()
    const big = Buffer.alloc(STATIC_STREAM_ABOVE, 7)
    writeFileSync(join(dir, 'assets/big.js'), big)
    writeFileSync(join(dir, 'index.html'), '<p>home</p>')
    writeFileSync(join(dir, 'readme.txt'), 'notes')
    const outside = join(dir, '..', 'secret.txt')
    writeFileSync(outside, 'secret')
    const handler = createStaticHandler(dir)

    const streamed = await handler(
      request('/assets/big.js'),
      new URL('http://nas/assets/big.js')
    )
    expect(Buffer.from(await streamed.arrayBuffer())).toEqual(big)
    expect(streamed.headers.get('cache-control')).toContain('immutable')

    const text = await handler(
      request('/readme.txt'),
      new URL('http://nas/readme.txt')
    )
    expect(text.headers.get('cache-control')).toBe('no-cache')
    expect(await text.text()).toBe('notes')

    const escaped = await handler(
      request('/../secret.txt'),
      new URL('http://nas/../secret.txt')
    )
    expect(await escaped.text()).toBe('<p>home</p>')
  })

  it('大文件打开失败时回 index.html，不写出文件响应', async () => {
    const dir = webDir()
    writeFileSync(
      join(dir, 'assets/locked.js'),
      Buffer.alloc(STATIC_STREAM_ABOVE, 7)
    )
    writeFileSync(join(dir, 'index.html'), '<p>home</p>')
    chmodSync(join(dir, 'assets/locked.js'), 0)
    const handler = createStaticHandler(dir)

    const res = await handler(
      request('/assets/locked.js'),
      new URL('http://nas/assets/locked.js')
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('html')
    expect(await res.text()).toBe('<p>home</p>')
  })
})
