import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaHandler } from '../../../src/main/library/media/media-protocol'
import {
  type ImageResizer,
  Thumbnailer,
  originalFile,
} from '../../../src/main/library/media/thumbnailer'
import { loadWebpEncoder } from '../../../src/main/library/media/webp-encoder'
import {
  mediaImageUrl,
  parseMediaImageUrl,
} from '../../../src/shared/library/media-url'

const KEY = 'ab'.repeat(16)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-thumb-'))
  mkdirSync(join(dir, 'orig', 'ab'), { recursive: true })
  // JPEG 文件头，原图类型按文件头判断
  writeFileSync(
    originalFile(dir, KEY),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 假缩放：按目标宽度生成 2:3 的渐变图，记录调用。 */
function fakeResizer(): ImageResizer & { calls: number[] } {
  const calls: number[] = []
  const fn = (async (_path: string, width: number) => {
    calls.push(width)
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
  }) as ImageResizer & { calls: number[] }
  fn.calls = calls
  return fn
}

const RIFF = [0x52, 0x49, 0x46, 0x46]

describe('Thumbnailer + yingbox-media 协议', () => {
  it('按需生成 300w / 780w WebP，带一年 immutable 强缓存；第二次直接读盘', async () => {
    const resize = fakeResizer()
    const encode = await loadWebpEncoder()
    const handler = createMediaHandler(
      dir,
      new Thumbnailer(dir, resize, encode)
    )
    const res = await handler(new Request(mediaImageUrl(KEY, 300)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    const body = new Uint8Array(await res.arrayBuffer())
    expect([...body.subarray(0, 4)]).toEqual(RIFF)
    await handler(new Request(mediaImageUrl(KEY, 300)))
    expect(resize.calls).toEqual([300])

    // ETag 命中返回 304
    const etag = res.headers.get('etag')!
    const cached = await handler(
      new Request(mediaImageUrl(KEY, 300), {
        headers: { 'If-None-Match': etag },
      })
    )
    expect(cached.status).toBe(304)

    // 原图按文件头给类型
    const orig = await handler(new Request(mediaImageUrl(KEY)))
    expect(orig.headers.get('content-type')).toBe('image/jpeg')
  })

  it('同一缩略图并发请求只生成一次；预热生成全部宽度', async () => {
    const resize = fakeResizer()
    const thumbs = new Thumbnailer(dir, resize, await loadWebpEncoder())
    await Promise.all([1, 2, 3].map(() => thumbs.ensure(KEY, 780)))
    expect(resize.calls).toEqual([780])
    thumbs.warm([KEY])
    await thumbs.idle()
    expect(resize.calls.sort()).toEqual([300, 780])
  })

  it('编码器不可用时退回 JPEG；非法地址与不存在的图片 404', async () => {
    const thumbs = new Thumbnailer(dir, fakeResizer(), undefined)
    const handler = createMediaHandler(dir, thumbs)
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
  })

  it('地址解析', () => {
    expect(parseMediaImageUrl(mediaImageUrl(KEY, 780))).toEqual({
      key: KEY,
      width: 780,
    })
    expect(parseMediaImageUrl(`yingbox-media://image/${KEY}`)).toEqual({
      key: KEY,
    })
    expect(parseMediaImageUrl('https://example.com/x')).toBeNull()
  })
})
