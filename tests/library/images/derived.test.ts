import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openLibraryDb } from '../../../src/main/library/db/database'
import {
  codecDeriver,
  cropPosterRight,
  parseDerived,
  posterFromCover,
  sourceOf,
} from '../../../src/main/library/images/derived'
import { ImageCache } from '../../../src/main/library/images/image-cache'
import { inProcessCodec } from '../../../src/main/thumbnails/codec-client'
import {
  decodeImage,
  encodeJpeg,
} from '../../../src/main/thumbnails/image-codec'
import { imageKey, originalPath } from '../../../src/main/thumbnails/paths'

/** 左半红、右半绿的纯色图。 */
function halves(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rgba.set(x < width / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255], i)
    }
  return rgba
}

describe('派生地址', () => {
  it('封面 → 派生海报地址可往返；重复包装不叠加；未知操作当普通图', () => {
    const url = posterFromCover('https://a/c.jpg')
    expect(url).toBe('https://a/c.jpg#yingbox=poster-right')
    expect(posterFromCover(url)).toBe(url)
    expect(parseDerived(url)).toEqual({
      source: 'https://a/c.jpg',
      op: 'poster-right',
    })
    expect(sourceOf(url)).toBe('https://a/c.jpg')
    expect(parseDerived('https://a/c.jpg')).toEqual({
      source: 'https://a/c.jpg',
    })
    expect(parseDerived('https://a/c.jpg#yingbox=zzz').op).toBeUndefined()
    expect(imageKey(url)).not.toBe(imageKey('https://a/c.jpg'))
  })
})

describe('cropPosterRight', () => {
  it('横版按 379:538 裁右侧，全是右半的像素', () => {
    const out = cropPosterRight({
      rgba: halves(800, 538),
      width: 800,
      height: 538,
    })
    expect([out.width, out.height]).toEqual([379, 538])
    expect(out.rgba.length).toBe(379 * 538 * 4)
    for (const i of [0, (379 * 269 + 100) * 4, out.rgba.length - 4])
      expect([...out.rgba.subarray(i, i + 4)]).toEqual([0, 255, 0, 255])
  })

  it('本来就是竖版 / 方图不裁', () => {
    const image = { rgba: halves(400, 400), width: 400, height: 400 }
    expect(cropPosterRight(image)).toBe(image)
  })
})

describe('封面裁海报（编解码任务 + 原图缓存）', () => {
  it('下载取源图地址，加工后落盘的是竖版 JPEG', async () => {
    const cover = await encodeJpeg(
      { rgba: halves(800, 538), width: 800, height: 538 },
      90
    )
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: {
        get: (n: string) => (n === 'content-type' ? 'image/jpeg' : null),
      },
      arrayBuffer: async () => cover.slice().buffer,
    }))
    const mediaDir = mkdtempSync(join(tmpdir(), 'derived-'))
    const cache = new ImageCache({
      db: openLibraryDb(':memory:'),
      mediaDir,
      fetch,
      derive: codecDeriver(inProcessCodec()),
    })
    const url = posterFromCover('https://pics.dmm.co.jp/x/abc00001pl.jpg')
    const result = await cache.ensure([url])
    expect(result.get(url)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(
      'https://pics.dmm.co.jp/x/abc00001pl.jpg',
      expect.anything()
    )
    const saved = await decodeImage(
      new Uint8Array(readFileSync(originalPath(mediaDir, imageKey(url))))
    )
    expect([saved.width, saved.height]).toEqual([379, 538])
  })

  it('加工失败按下载失败记，不落盘', async () => {
    const cache = new ImageCache({
      db: openLibraryDb(':memory:'),
      mediaDir: mkdtempSync(join(tmpdir(), 'derived-')),
      fetch: async () => ({
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 1, 2]).buffer,
      }),
      derive: codecDeriver(inProcessCodec()),
    })
    const url = posterFromCover('https://a/broken.jpg')
    expect((await cache.ensure([url])).get(url)).toBeNull()
  })
})
