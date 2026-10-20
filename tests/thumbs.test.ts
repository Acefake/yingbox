import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { thumbs } from '../src/shared/contract/thumbs'
import {
  MAX_THUMB_BYTES,
  fitWidth,
  isThumbSource,
  isWebp,
  parseThumbUrl,
  pickThumbWidth,
  thumbUrl,
} from '../src/shared/thumbs'
import {
  TOUCH_INTERVAL_MS,
  ThumbCache,
  planEviction,
  thumbKey,
} from '../src/main/thumbnails/cache'
import { createThumbService } from '../src/main/thumbnails/service'

/** 最小合法 WebP 头 + 若干字节 */
const webp = (size = 32): Uint8Array => {
  const bytes = new Uint8Array(size)
  bytes.set(
    [...'RIFF'].map(c => c.charCodeAt(0)),
    0
  )
  bytes.set(
    [...'WEBP'].map(c => c.charCodeAt(0)),
    8
  )
  return bytes
}

describe('缩略图共用规则', () => {
  it('来源只认 http(s) 与 amane://image/', () => {
    expect(isThumbSource('https://a.com/x.jpg')).toBe(true)
    expect(isThumbSource('http://a.com/x.jpg')).toBe(true)
    expect(isThumbSource('amane://image/?path=%2Fapi')).toBe(true)
    expect(isThumbSource('local:///C:/x.jpg')).toBe(false)
    expect(isThumbSource('data:image/png;base64,xx')).toBe(false)
    expect(isThumbSource('')).toBe(false)
  })

  it('档位：取不小于 css × dpr 的最小档，超出用最大档', () => {
    expect(pickThumbWidth(200, 1)).toBe(240)
    expect(pickThumbWidth(240, 1)).toBe(240)
    expect(pickThumbWidth(200, 2)).toBe(480)
    expect(pickThumbWidth(360, 2)).toBe(720)
    expect(pickThumbWidth(360, 3)).toBe(720)
    // dpr < 1 按 1 算，不因缩放降档
    expect(pickThumbWidth(300, 0.5)).toBe(360)
  })

  it('thumb:// 地址可往返解析，非法宽度 / 来源 / 协议都拒绝', () => {
    const source = 'https://img.example.com/a b.jpg?x=1&y=2'
    const url = thumbUrl(source, 360)!
    expect(parseThumbUrl(url)).toEqual({ source, width: 360 })
    expect(thumbUrl('file:///etc/passwd', 240)).toBeNull()
    expect(parseThumbUrl(url.replace('w=360', 'w=361'))).toBeNull()
    expect(
      parseThumbUrl(`thumb://img/?w=240&src=${encodeURIComponent('file:///x')}`)
    ).toBeNull()
    expect(parseThumbUrl(url.replace('thumb:', 'https:'))).toBeNull()
    expect(parseThumbUrl('not a url')).toBeNull()
  })

  it('等比缩到目标宽度，窄图不放大', () => {
    expect(fitWidth(1000, 1500, 240)).toEqual({ width: 240, height: 360 })
    expect(fitWidth(200, 300, 240)).toEqual({ width: 200, height: 300 })
    expect(fitWidth(10000, 1, 240)).toEqual({ width: 240, height: 1 })
  })

  it('WebP 文件头校验', () => {
    expect(isWebp(webp())).toBe(true)
    expect(isWebp(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false)
    expect(isWebp(webp().subarray(0, 11))).toBe(false)
    // 同为 RIFF 容器的 WAV 不算
    const wav = webp()
    wav.set(
      [...'WAVE'].map(c => c.charCodeAt(0)),
      8
    )
    expect(isWebp(wav)).toBe(false)
  })

  it('thumbs.put 参数：宽度必须是档位，数据必须是 ≤ 2MB 的 Uint8Array', () => {
    const parse = thumbs.calls.put.parse
    expect(parse(['https://a/x.jpg', 240, webp()])).toHaveLength(3)
    expect(() => parse(['https://a/x.jpg', 250, webp()])).toThrow()
    expect(() => parse(['https://a/x.jpg', 240, [1, 2]])).toThrow()
    expect(() =>
      parse(['https://a/x.jpg', 240, new Uint8Array(MAX_THUMB_BYTES + 1)])
    ).toThrow()
  })
})

describe('LRU 淘汰计划', () => {
  const entries = [
    { name: 'old', size: 40, usedAt: 1 },
    { name: 'mid', size: 40, usedAt: 2 },
    { name: 'new', size: 40, usedAt: 3 },
  ]
  it('没超上限不删', () => {
    expect(planEviction(entries, 120)).toEqual([])
  })
  it('超了按最久未用删到 90% 以下', () => {
    expect(planEviction(entries, 100)).toEqual(['old'])
    expect(planEviction(entries, 50)).toEqual(['old', 'mid'])
  })
  it('刚写入的条目不删', () => {
    expect(planEviction(entries, 50, new Set(['old']))).toEqual(['mid', 'new'])
  })
})

describe('ThumbCache（真实临时目录）', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('写入后可读，文件名是来源 + 宽度的哈希', async () => {
    dir = await mkdtemp(join(tmpdir(), 'thumb-'))
    const cache = new ThumbCache(dir)
    const name = thumbKey('https://a/x.jpg', 240)
    expect(name).toMatch(/^[0-9a-f]{40}\.webp$/)
    expect(name).not.toBe(thumbKey('https://a/x.jpg', 360))
    expect(await cache.get(name)).toBeNull()
    await cache.put(name, webp(100))
    expect((await cache.get(name))?.length).toBe(100)
    expect(await readdir(dir)).toEqual([name])
  })

  it('超上限按最近使用淘汰，读过的保留', async () => {
    dir = await mkdtemp(join(tmpdir(), 'thumb-'))
    let now = 1_000_000
    const cache = new ThumbCache(dir, 250, () => now)
    for (const n of ['a', 'b']) {
      now += 10
      await cache.put(`${n}.webp`, webp(100))
    }
    // 过了标记间隔后读 a，a 变成最近使用
    now += TOUCH_INTERVAL_MS + 1
    expect(await cache.get('a.webp')).not.toBeNull()
    now += 10
    await cache.put('c.webp', webp(100))
    expect((await readdir(dir)).sort()).toEqual(['a.webp', 'c.webp'])
    expect(await cache.size()).toBe(200)
  })

  it('重启后从目录重建索引，并清掉残留的临时文件', async () => {
    dir = await mkdtemp(join(tmpdir(), 'thumb-'))
    await writeFile(join(dir, 'x.webp'), webp(64))
    await writeFile(join(dir, 'y.webp.123.tmp'), 'partial')
    const cache = new ThumbCache(dir)
    expect(await cache.size()).toBe(64)
    expect(await readdir(dir)).toEqual(['x.webp'])
  })

  it('命中不到标记间隔不改 mtime（少写盘）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'thumb-'))
    let now = Date.now()
    const cache = new ThumbCache(dir, 1000, () => now)
    await cache.put('a.webp', webp())
    const before = (await stat(join(dir, 'a.webp'))).mtimeMs
    now += 1000
    await cache.get('a.webp')
    expect((await stat(join(dir, 'a.webp'))).mtimeMs).toBe(before)
  })
})

describe('thumb:// 处理', () => {
  const source = 'https://img.example.com/p.jpg'
  const setup = (stored: Map<string, Uint8Array> = new Map()) => {
    const loadOriginal = vi.fn(async () => ({
      data: new Uint8Array([1, 2, 3]),
      type: 'image/jpeg',
    }))
    const service = createThumbService({
      cache: {
        get: async name => stored.get(name) ?? null,
        put: async (name, data) => void stored.set(name, data),
      },
      loadOriginal,
    })
    return { service, loadOriginal, stored }
  }

  it('命中返回 WebP（x-thumb: hit），不取原图', async () => {
    const stored = new Map([[thumbKey(source, 240), webp()]])
    const { service, loadOriginal } = setup(stored)
    const res = await service.respond(thumbUrl(source, 240)!)
    expect(res.headers.get('x-thumb')).toBe('hit')
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Thumb')
    expect(loadOriginal).not.toHaveBeenCalled()
  })

  it('未命中代取原图（x-thumb: miss），并发同一张只下载一次', async () => {
    const { service, loadOriginal } = setup()
    const url = thumbUrl(source, 240)!
    const [a, b] = await Promise.all([
      service.respond(url),
      service.respond(url),
    ])
    expect(a.headers.get('x-thumb')).toBe('miss')
    expect(a.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    )
    // 稍后 Worker 再取也走内存，不再下载
    await service.respond(thumbUrl(source, 360)!)
    expect(loadOriginal).toHaveBeenCalledTimes(1)
  })

  it('地址非法 400，原图取不到 502', async () => {
    const { service, loadOriginal } = setup()
    expect((await service.respond('thumb://img/?w=1&src=x')).status).toBe(400)
    loadOriginal.mockRejectedValueOnce(new Error('boom'))
    expect((await service.respond(thumbUrl(source, 240)!)).status).toBe(502)
  })

  it('put 只收 WebP 和支持的来源，按 thumbKey 落盘', async () => {
    const { service, stored } = setup()
    expect(await service.put(source, 240, new Uint8Array([0xff, 0xd8]))).toBe(
      false
    )
    expect(await service.put('file:///x.jpg', 240, webp())).toBe(false)
    expect(stored.size).toBe(0)
    expect(await service.put(source, 240, webp())).toBe(true)
    expect([...stored.keys()]).toEqual([thumbKey(source, 240)])
    const res = await service.respond(thumbUrl(source, 240)!)
    expect(res.headers.get('x-thumb')).toBe('hit')
  })
})
