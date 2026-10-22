import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Codec, inProcessCodec } from '../src/main/thumbnails/codec-client'
import type { CodecJob } from '../src/main/thumbnails/codec-jobs'
import {
  focusName,
  imageKey,
  originalPath,
  thumbName,
} from '../src/main/thumbnails/paths'
import { createThumbnailPipeline } from '../src/main/thumbnails/pipeline'
import type { ImageResizer } from '../src/main/thumbnails/thumbnailer'
import { loadWebpEncoder } from '../src/main/thumbnails/webp-codec'
import { FOCUS_VERSION } from '../src/shared/media-focus'
import { mediaImageUrl, thumbUrl } from '../src/shared/media-url'
import { type Canvas, canvas, person } from './fixtures/focus-images'

/**
 * 焦点随缩略图缓存持久化（<mediaDir>/thumb/<前两位>/<key>.focus.json，同一个 LRU）：
 * 生成缩略图时顺手算（只算会被竖框裁掉的横图）；已有缩略图没焦点时解码缓存的缩略图现算；
 * 第二次直接读文件；人脸检测（渲染层 FaceDetector）的结果可写回并优先。
 */

const KEY = 'cd'.repeat(16)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-focus-'))
  mkdirSync(join(dir, 'orig', 'cd'), { recursive: true })
  writeFileSync(originalPath(dir, KEY), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 最近邻缩放到指定宽度。 */
function scale(c: Canvas, width: number): Canvas {
  const height = Math.round((c.height * width) / c.width)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x * c.width) / width)
      const sy = Math.floor((y * c.height) / height)
      rgba.set(
        c.rgba.subarray((sy * c.width + sx) * 4, (sy * c.width + sx) * 4 + 4),
        (y * width + x) * 4
      )
    }
  return { rgba, width, height }
}

/** 假缩放：不管原图内容，给出 picture 缩到目标宽度的像素；记录调用次数。 */
function resizer(picture: Canvas): ImageResizer & { calls: number } {
  const resize: ImageResizer = async (_original, width) => {
    fn.calls++
    const out = scale(picture, Math.min(width, picture.width))
    return { ...out, jpeg: () => new Uint8Array([0xff, 0xd8]) }
  }
  const fn = resize as ImageResizer & { calls: number }
  fn.calls = 0
  return fn
}

/** 记录每次任务 op 的编解码器（真跑 wasm 编解码与焦点计算）。 */
function spyCodec(): Codec & { ops: CodecJob['op'][] } {
  const inner = inProcessCodec()
  const fn = ((job, transfer) => {
    fn.ops.push(job.op)
    return inner(job, transfer)
  }) as Codec & { ops: CodecJob['op'][] }
  fn.ops = []
  return fn
}

const landscape = (): Canvas => person(canvas(800, 538), 0.8, 0.3, 0.1)
const url = mediaImageUrl(KEY, 300)
const sidecar = (): string => join(dir, 'thumb', focusName(KEY))

/** codec 传 null 表示没有编解码线程。 */
function pipeline(
  picture: Canvas,
  codec: Codec | null = spyCodec()
): {
  p: ReturnType<typeof createThumbnailPipeline>
  resize: ReturnType<typeof resizer>
  codec: ReturnType<typeof spyCodec>
} {
  const resize = resizer(picture)
  const p = createThumbnailPipeline({
    mediaDir: dir,
    codec: codec ?? undefined,
    resizer: resize,
    log: () => {},
  })
  return { p, resize, codec: codec as ReturnType<typeof spyCodec> }
}

describe('焦点：计算与持久化', () => {
  it('第一次：生成缩略图时算出焦点，写进缩略图缓存目录', async () => {
    const { p } = pipeline(landscape())
    const [focus] = await p.focus.get([url])
    expect(focus?.by).toBe('skin')
    expect(Math.abs(focus!.x - 0.8)).toBeLessThan(0.06)
    expect(JSON.parse(readFileSync(sidecar(), 'utf8'))).toEqual(focus)
  })

  it('缓存命中：不再缩放、不再解码、不再计算（重启后也一样）', async () => {
    const first = pipeline(landscape())
    const [focus] = await first.p.focus.get([url])
    const again = pipeline(landscape())
    expect(await again.p.focus.get([url, url])).toEqual([focus, focus])
    expect(again.resize.calls).toBe(0)
    expect(again.codec.ops).toEqual([])
  })

  it('已有缩略图（升级前生成的）没有焦点：解码缓存的缩略图现算，不重新生成', async () => {
    const small = scale(landscape(), 300)
    const webp = await (
      await loadWebpEncoder()
    )(small.rgba, small.width, small.height, 80)
    mkdirSync(join(dir, 'thumb', 'cd'), { recursive: true })
    writeFileSync(join(dir, 'thumb', thumbName(KEY, 300, 'webp')), webp)
    const { p, resize, codec } = pipeline(landscape())
    const [focus] = await p.focus.get([url])
    expect(resize.calls).toBe(0)
    expect(codec.ops).toEqual(['decode', 'focus'])
    expect(Math.abs(focus!.x - 0.8)).toBeLessThan(0.06)
  })

  it('算法版本变了：启发式结果重算；人脸检测的结果保留', async () => {
    mkdirSync(join(dir, 'thumb', 'cd'), { recursive: true })
    writeFileSync(
      sidecar(),
      JSON.stringify({ v: 0, x: 0.1, y: 0.1, by: 'skin' })
    )
    const { p } = pipeline(landscape())
    const [fresh] = await p.focus.get([url])
    expect(fresh?.v).toBe(FOCUS_VERSION)
    expect(fresh!.x).toBeGreaterThan(0.7)

    const face = { v: 0, x: 0.33, y: 0.2, by: 'face' }
    writeFileSync(sidecar(), JSON.stringify(face))
    expect(await pipeline(landscape()).p.focus.get([url])).toEqual([face])
  })

  it('写回人脸检测结果：之后读到的是它；非法记录拒绝', async () => {
    const { p } = pipeline(landscape())
    await p.focus.get([url])
    const face = { v: FOCUS_VERSION, x: 0.62, y: 0.25, by: 'face' as const }
    await p.focus.save(url, face)
    expect(await pipeline(landscape()).p.focus.get([url])).toEqual([face])
    await expect(p.focus.save(url, { ...face, x: 3 })).rejects.toThrow()
    await expect(p.focus.save('https://x.test/a.jpg', face)).rejects.toThrow()
  })

  it('不是缩略图地址、原图不存在：null', async () => {
    const { p } = pipeline(landscape())
    const missing = mediaImageUrl('ef'.repeat(16), 300)
    expect(
      await p.focus.get([
        'https://x.test/a.jpg',
        'yingbox-media://image/zz',
        '',
        missing,
      ])
    ).toEqual([null, null, null, null])
  })

  it('任意来源（thumb/?src=）同样可算，key 与缩略图一致', async () => {
    const file = join(dir, 'cover.jpg')
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const source = pathToFileURL(file).href
    const { p } = pipeline(landscape())
    const [focus] = await p.focus.get([thumbUrl(source, 300)!])
    expect(focus?.by).toBe('skin')
    expect(existsSync(join(dir, 'thumb', focusName(imageKey(source))))).toBe(
      true
    )
  })

  it('没有编解码线程：不算，返回 null', async () => {
    const { p } = pipeline(landscape(), null)
    expect(await p.focus.get([url])).toEqual([null])
  })
})

describe('焦点：预热时顺手算', () => {
  it('横图（会被竖框裁）：预热完就有焦点文件', async () => {
    const { p } = pipeline(landscape())
    p.warm([KEY])
    await p.idle()
    expect(existsSync(sidecar())).toBe(true)
  })

  it('竖图（竖框不裁）：预热不算，省下计算和文件', async () => {
    const { p, codec } = pipeline(person(canvas(400, 600), 0.5, 0.2, 0.08))
    p.warm([KEY])
    await p.idle()
    expect(existsSync(sidecar())).toBe(false)
    expect(codec.ops).not.toContain('focus')
  })
})
