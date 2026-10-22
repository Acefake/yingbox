import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  TOUCH_INTERVAL_MS,
  ThumbCache,
  planEviction,
} from '../src/main/thumbnails/cache'
import { imageKey, originalPath, thumbName } from '../src/main/thumbnails/paths'
import { createMediaHandler } from '../src/main/thumbnails/protocol'
import {
  MAX_ORIGINAL_BYTES,
  type SourceDeps,
  createSourceLoader,
  isWebp,
} from '../src/main/thumbnails/sources'
import {
  type ImageResizer,
  type OriginalImage,
  Thumbnailer,
} from '../src/main/thumbnails/thumbnailer'
import {
  loadWebpDecoder,
  loadWebpEncoder,
} from '../src/main/thumbnails/webp-codec'
import { thumbSrc } from '@/services/thumbnails'
import {
  isThumbSource,
  mediaImageUrl,
  parseMediaUrl,
  pickThumbWidth,
  thumbUrl,
} from '../src/shared/media-url'

const KEY = 'ab'.repeat(16)
const RIFF = [0x52, 0x49, 0x46, 0x46]
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-thumb-'))
  mkdirSync(join(dir, 'orig', 'ab'), { recursive: true })
  // JPEG 文件头，原图类型按文件头判断
  writeFileSync(originalPath(dir, KEY), JPEG)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 假缩放：按目标宽度生成 2:3 的渐变图，记录调用（宽度与原图形态）。 */
function fakeResizer(): ImageResizer & {
  calls: number[]
  originals: OriginalImage[]
} {
  const calls: number[] = []
  const originals: OriginalImage[] = []
  const fn = (async (original: OriginalImage, width: number) => {
    calls.push(width)
    originals.push(original)
    const height = Math.round(width * 1.5)
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = (i / 4) % 256
      rgba[i + 3] = 255
    }
    return {
      rgba,
      width,
      height,
      jpeg: () => Uint8Array.from([0xff, 0xd8, 0xff]),
    }
  }) satisfies ImageResizer
  return Object.assign(fn, { calls, originals })
}

async function setup(
  options: {
    encoder?: boolean
    maxBytes?: number
    loadSource?: (source: string) => Promise<OriginalImage>
  } = {}
): Promise<{
  resize: ReturnType<typeof fakeResizer>
  cache: ThumbCache
  thumbnailer: Thumbnailer
  loadSource: Mock<(source: string) => Promise<OriginalImage>>
  handler: (request: Request) => Promise<Response>
}> {
  const resize = fakeResizer()
  const cache = new ThumbCache(join(dir, 'thumb'), options.maxBytes)
  const thumbnailer = new Thumbnailer(
    cache,
    resize,
    options.encoder === false ? undefined : await loadWebpEncoder()
  )
  const loadSource = vi.fn(
    options.loadSource ?? (async () => ({ bytes: new Uint8Array(JPEG) }))
  )
  const handler = createMediaHandler({ mediaDir: dir, thumbnailer, loadSource })
  return { resize, cache, thumbnailer, loadSource, handler }
}

describe('yingbox-media 地址', () => {
  it('媒体库原图地址可往返解析，宽度只认档位', () => {
    expect(parseMediaUrl(mediaImageUrl(KEY, 780))).toEqual({
      kind: 'image',
      key: KEY,
      width: 780,
    })
    expect(parseMediaUrl(mediaImageUrl(KEY))).toEqual({
      kind: 'image',
      key: KEY,
    })
    expect(parseMediaUrl(`yingbox-media://image/${KEY}?w=123`)).toBeNull()
    expect(parseMediaUrl('yingbox-media://image/../../etc/passwd')).toBeNull()
    expect(parseMediaUrl('https://example.com/x')).toBeNull()
    expect(parseMediaUrl('not a url')).toBeNull()
  })

  it('任意来源的缩略图地址可往返解析，必须带宽度', () => {
    const source = 'https://img.example.com/a b.jpg?x=1&y=2'
    const url = thumbUrl(source, 480)!
    expect(url.startsWith('yingbox-media://thumb/')).toBe(true)
    expect(parseMediaUrl(url)).toEqual({ kind: 'thumb', source, width: 480 })
    expect(parseMediaUrl(url.replace('w=480', 'w=481'))).toBeNull()
    expect(parseMediaUrl(url.replace('w=480&', ''))).toBeNull()
    expect(
      parseMediaUrl(
        `yingbox-media://thumb/?w=300&src=${encodeURIComponent('file:///etc/passwd')}`
      )
    ).toBeNull()
    expect(
      parseMediaUrl('yingbox-media://other/?w=300&src=https://a/x.jpg')
    ).toBeNull()
  })

  it('来源：http(s)、带图片扩展名的本地 file:///', () => {
    expect(isThumbSource('https://a.com/x.jpg')).toBe(true)
    expect(isThumbSource('http://a.com/x.jpg')).toBe(true)
    expect(isThumbSource('file:///C:/海报/poster.JPG')).toBe(true)
    expect(isThumbSource('file:///home/a/fanart.webp')).toBe(true)
    expect(isThumbSource('file:///etc/passwd')).toBe(false)
    expect(isThumbSource('file://server/share/a.jpg')).toBe(false)
    expect(isThumbSource('local:///C:/x.jpg')).toBe(false)
    expect(isThumbSource('data:image/png;base64,xx')).toBe(false)
    expect(isThumbSource('')).toBe(false)
    expect(thumbUrl('data:image/png;base64,xx', 300)).toBeNull()
  })

  it('档位：取不小于 css × dpr 的最小档，超出用最大档', () => {
    expect(pickThumbWidth(200, 1)).toBe(300)
    expect(pickThumbWidth(300, 1)).toBe(300)
    expect(pickThumbWidth(200, 2)).toBe(480)
    expect(pickThumbWidth(360, 1)).toBe(480)
    expect(pickThumbWidth(360, 2)).toBe(780)
    expect(pickThumbWidth(360, 3)).toBe(780)
    // dpr < 1 按 1 算，不因缩放降档
    expect(pickThumbWidth(301, 0.5)).toBe(480)
  })
})

describe('渲染层 thumbSrc', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('桌面端换成缩略图地址；网页版或来源不支持时原样返回', () => {
    const cover = 'https://a.com/x.jpg'
    expect(thumbSrc(cover, 300)).toBe(cover)
    vi.stubGlobal('window', { api: {} })
    expect(thumbSrc(cover, 300)).toBe(thumbUrl(cover, 300))
    expect(thumbSrc('data:image/png;base64,xx', 300)).toBe(
      'data:image/png;base64,xx'
    )
  })
})

describe('媒体库原图（image/<key>）', () => {
  it('按需生成 WebP，带一年 immutable 强缓存；第二次直接读盘', async () => {
    const { handler, resize } = await setup()
    const res = await handler(new Request(mediaImageUrl(KEY, 300)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    const body = new Uint8Array(await res.arrayBuffer())
    expect([...body.subarray(0, 4)]).toEqual(RIFF)
    expect(existsSync(join(dir, 'thumb', thumbName(KEY, 300, 'webp')))).toBe(
      true
    )
    await handler(new Request(mediaImageUrl(KEY, 300)))
    expect(resize.calls).toEqual([300])
    expect(resize.originals[0]).toEqual({ path: originalPath(dir, KEY) })

    // ETag 命中返回 304
    const etag = res.headers.get('etag')!
    const cached = await handler(
      new Request(mediaImageUrl(KEY, 300), {
        headers: { 'If-None-Match': etag },
      })
    )
    expect(cached.status).toBe(304)

    // 原图按文件头给类型；HEAD 不带响应体
    const orig = await handler(new Request(mediaImageUrl(KEY)))
    expect(orig.headers.get('content-type')).toBe('image/jpeg')
    const head = await handler(
      new Request(mediaImageUrl(KEY, 300), { method: 'HEAD' })
    )
    expect(head.status).toBe(200)
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    expect(
      (await handler(new Request(mediaImageUrl(KEY), { method: 'POST' })))
        .status
    ).toBe(405)
  })

  it('同一缩略图并发请求只生成一次；预热生成全部宽度', async () => {
    const { thumbnailer, resize } = await setup()
    const load = async (): Promise<OriginalImage> => ({
      path: originalPath(dir, KEY),
    })
    await Promise.all([1, 2, 3].map(() => thumbnailer.ensure(KEY, 780, load)))
    expect(resize.calls).toEqual([780])
    thumbnailer.warm([{ key: KEY, load }])
    await thumbnailer.idle()
    expect(resize.calls.sort()).toEqual([300, 480, 780])
  })

  it('编码器不可用时退回 JPEG；非法地址与不存在的图片 404', async () => {
    const { handler } = await setup({ encoder: false })
    const res = await handler(new Request(mediaImageUrl(KEY, 780)))
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(
      (await handler(new Request('yingbox-media://image/../../etc/passwd')))
        .status
    ).toBe(404)
    expect(
      (await handler(new Request(`yingbox-media://image/${KEY}?w=123`))).status
    ).toBe(404)
    expect(
      (await handler(new Request(mediaImageUrl('cd'.repeat(16), 300)))).status
    ).toBe(404)
    expect(
      (await handler(new Request(mediaImageUrl('cd'.repeat(16))))).status
    ).toBe(404)
  })

  it('缓存文件被外部删掉后重新生成', async () => {
    const { handler, resize } = await setup()
    await handler(new Request(mediaImageUrl(KEY, 300)))
    rmSync(join(dir, 'thumb', thumbName(KEY, 300, 'webp')))
    const res = await handler(new Request(mediaImageUrl(KEY, 300)))
    expect(res.status).toBe(200)
    expect(resize.calls).toEqual([300, 300])
  })
})

describe('任意来源（thumb/?src=）', () => {
  const source = 'https://img.example.com/p.jpg'

  it('取原图生成 WebP 落进同一个缓存目录；再次请求不再取原图', async () => {
    const { handler, loadSource, resize } = await setup()
    const res = await handler(new Request(thumbUrl(source, 480)!))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('etag')).toBe(`"${imageKey(source)}-480"`)
    expect(loadSource).toHaveBeenCalledWith(source)
    expect(resize.originals[0]).toEqual({ bytes: new Uint8Array(JPEG) })
    expect(
      existsSync(join(dir, 'thumb', thumbName(imageKey(source), 480, 'webp')))
    ).toBe(true)
    await handler(new Request(thumbUrl(source, 480)!))
    expect(loadSource).toHaveBeenCalledTimes(1)
  })

  it('同一来源并发请求只取一次原图', async () => {
    const { handler, loadSource } = await setup()
    await Promise.all(
      [1, 2, 3].map(() => handler(new Request(thumbUrl(source, 300)!)))
    )
    expect(loadSource).toHaveBeenCalledTimes(1)
  })

  it('媒体库已下载过同一地址的原图时直接用，不再出网', async () => {
    const tmdb = 'https://image.tmdb.org/t/p/w780/x.jpg'
    const key = imageKey(tmdb)
    mkdirSync(join(dir, 'orig', key.slice(0, 2)), { recursive: true })
    writeFileSync(originalPath(dir, key), JPEG)
    const { handler, loadSource, resize } = await setup()
    expect((await handler(new Request(thumbUrl(tmdb, 300)!))).status).toBe(200)
    expect(loadSource).not.toHaveBeenCalled()
    expect(resize.originals[0]).toEqual({ path: originalPath(dir, key) })
  })

  it('原图取不到返回 502（<img> 退回原图），不写缓存，下次重试', async () => {
    const { handler, loadSource } = await setup({
      loadSource: async () => {
        throw new Error('HTTP 404')
      },
    })
    const res = await handler(new Request(thumbUrl(source, 300)!))
    expect(res.status).toBe(502)
    expect(existsSync(join(dir, 'thumb'))).toBe(false)
    await handler(new Request(thumbUrl(source, 300)!))
    expect(loadSource).toHaveBeenCalledTimes(2)
  })

  it('解不了的原图返回 404', async () => {
    const thumbnailer = new Thumbnailer(
      new ThumbCache(join(dir, 'thumb')),
      async () => null,
      undefined
    )
    const handler = createMediaHandler({
      mediaDir: dir,
      thumbnailer,
      loadSource: async () => ({ bytes: new Uint8Array([1, 2, 3]) }),
    })
    expect((await handler(new Request(thumbUrl(source, 300)!))).status).toBe(
      404
    )
  })

  it('全部缩略图共用一个 LRU 上限：超了淘汰最久未用的', async () => {
    const { handler, cache } = await setup({ maxBytes: 1 })
    await handler(new Request(mediaImageUrl(KEY, 300)))
    await handler(new Request(thumbUrl(source, 300)!))
    // 上限 1 字节：每次写入后只保留刚写的那张
    const shards = readdirSync(join(dir, 'thumb')).flatMap(shard =>
      readdirSync(join(dir, 'thumb', shard))
    )
    expect(shards).toEqual([`${imageKey(source)}_300.webp`])
    expect(await cache.size()).toBeGreaterThan(0)
  })
})

describe('取原图', () => {
  const image = (type = 'image/jpeg', length?: number): Response =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'content-type': type,
        ...(length ? { 'content-length': String(length) } : {}),
      },
    })
  const deps = (
    response: Response = image()
  ): SourceDeps & {
    fetchImage: Mock<SourceDeps['fetchImage']>
    readLimited: Mock<SourceDeps['readLimited']>
  } => ({
    fetchImage: vi.fn(async () => response),
    readLimited: vi.fn(
      async (r: Response) => new Uint8Array(await r.arrayBuffer())
    ),
  })

  it('本地 file:/// 给路径，不读字节', async () => {
    const d = deps()
    const file = join(dir, '海报 1.jpg')
    const load = createSourceLoader(d)
    expect(await load(pathToFileURL(file).href)).toEqual({ path: file })
    expect(d.fetchImage).not.toHaveBeenCalled()
  })

  it('http(s) 走带防护的出网', async () => {
    const d = deps()
    const load = createSourceLoader(d)
    expect(await load('https://a.com/x.jpg')).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(d.fetchImage).toHaveBeenCalledWith('https://a.com/x.jpg')
    expect(d.readLimited.mock.calls[0][1]).toBe(MAX_ORIGINAL_BYTES)
  })

  it('重定向到图床占位图（DMM now_printing）时拒绝，不缩成缩略图', async () => {
    const placeholder = image()
    Object.defineProperty(placeholder, 'url', {
      value:
        'https://imgsrc.dmm.com/pics/mono/movie/n/now_printing/now_printing.jpg',
    })
    await expect(
      createSourceLoader(deps(placeholder))(
        'https://pics.dmm.co.jp/digital/video/pgd00630/pgd00630jp-1.jpg'
      )
    ).rejects.toThrow('占位图')
  })

  it('不是图片、超大小上限、不支持的协议都拒绝', async () => {
    await expect(
      createSourceLoader(deps(image('text/html')))('https://a.com/x')
    ).rejects.toThrow('响应不是图片')
    await expect(
      createSourceLoader(deps(image('image/jpeg', MAX_ORIGINAL_BYTES + 1)))(
        'https://a.com/x'
      )
    ).rejects.toThrow('大小上限')
    await expect(
      createSourceLoader(deps())('ftp://a.com/x.jpg')
    ).rejects.toThrow('不支持')
  })
})

describe('WebP 编解码（wasm）', () => {
  it('编出的 WebP 能解回同样尺寸的 RGBA', async () => {
    const width = 6
    const height = 4
    const rgba = new Uint8Array(width * height * 4).fill(200)
    const webp = await (await loadWebpEncoder())(rgba, width, height, 80)
    expect(isWebp(webp)).toBe(true)
    const decoded = await (await loadWebpDecoder())(webp)
    expect([decoded.width, decoded.height]).toEqual([width, height])
    expect(decoded.rgba.length).toBe(width * height * 4)
  })

  it('WebP 文件头校验（同为 RIFF 的 WAV 不算）', () => {
    const tag = (s: string): number[] => [...s].map(c => c.charCodeAt(0))
    const webp = new Uint8Array(16)
    webp.set(tag('RIFF'), 0)
    webp.set(tag('WEBP'), 8)
    expect(isWebp(webp)).toBe(true)
    expect(isWebp(webp.subarray(0, 11))).toBe(false)
    const wav = webp.slice()
    wav.set(tag('WAVE'), 8)
    expect(isWebp(wav)).toBe(false)
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

describe('ThumbCache（真实临时目录，两级目录）', () => {
  const name = (n: string): string => join('ab', `${n}.webp`)

  it('超上限按最近使用淘汰，读过的保留', async () => {
    let now = 1_000_000
    const cache = new ThumbCache(join(dir, 'c'), 250, () => now)
    for (const n of ['a', 'b']) {
      now += 10
      await cache.put(name(n), new Uint8Array(100))
    }
    // 过了标记间隔后读 a，a 变成最近使用
    now += TOUCH_INTERVAL_MS + 1
    expect(await cache.find(name('a'))).toBe(join(dir, 'c', name('a')))
    now += 10
    await cache.put(name('c'), new Uint8Array(100))
    expect(readdirSync(join(dir, 'c', 'ab')).sort()).toEqual([
      'a.webp',
      'c.webp',
    ])
    expect(await cache.size()).toBe(200)
  })

  it('重启后从目录重建索引，并清掉残留的临时文件与非缩略图文件不计', async () => {
    const root = join(dir, 'c')
    mkdirSync(join(root, 'ab'), { recursive: true })
    writeFileSync(join(root, name('x')), new Uint8Array(64))
    writeFileSync(join(root, 'ab', 'y.jpg'), new Uint8Array(16))
    writeFileSync(join(root, 'ab', 'y.webp.123.tmp'), 'partial')
    writeFileSync(join(root, 'ab', 'z.webp.abc.partial'), 'partial')
    writeFileSync(join(root, 'ab', 'notes.txt'), 'x')
    const cache = new ThumbCache(root)
    expect(await cache.size()).toBe(80)
    expect(readdirSync(join(root, 'ab')).sort()).toEqual([
      'notes.txt',
      'x.webp',
      'y.jpg',
    ])
  })

  it('命中不到标记间隔不改 mtime（少写盘）', async () => {
    let now = Date.now()
    const cache = new ThumbCache(join(dir, 'c'), 1000, () => now)
    await cache.put(name('a'), new Uint8Array(10))
    const before = statSync(join(dir, 'c', name('a'))).mtimeMs
    now += 1000
    await cache.find(name('a'))
    expect(statSync(join(dir, 'c', name('a'))).mtimeMs).toBe(before)
  })
})
