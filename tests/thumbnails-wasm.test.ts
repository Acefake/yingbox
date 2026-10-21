/**
 * 独立服务的缩略图缩放（纯 wasm，无 nativeImage）：JPEG / PNG / WebP 原图解码、按宽度缩小、编码 WebP，
 * 以及解不了的图返回 null。用 inProcessCodec 在当前线程跑同一套编解码任务。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inProcessCodec } from '../src/main/thumbnails/codec-client'
import { sniffImage } from '../src/main/thumbnails/image-codec'
import { createWasmResizer } from '../src/main/thumbnails/wasm-resizer'

const COVER = new Uint8Array(
  readFileSync(join(__dirname, 'fixtures/images/cover-800x538.jpg'))
)
const codec = inProcessCodec()
const resize = createWasmResizer(codec)

describe('wasm 缩放', () => {
  it('JPEG 原图缩到 300 宽，比例不变，再编成 WebP', async () => {
    const image = await resize({ bytes: COVER }, 300)
    expect(image).toMatchObject({ width: 300, height: 202 })
    expect(image!.rgba.byteLength).toBe(300 * 202 * 4)
    const webp = await codec(
      { op: 'encode', rgba: image!.rgba, width: 300, height: 202, quality: 80 },
      []
    )
    expect(sniffImage(webp.data)).toBe('webp')
  })

  it('原图比目标窄时不放大；WebP 原图也能解', async () => {
    const small = await resize({ bytes: COVER }, 780)
    expect(small).toMatchObject({ width: 780 })
    const original = await resize({ bytes: COVER }, 4000)
    expect(original).toMatchObject({ width: 800, height: 538 })
    const webp = await codec(
      {
        op: 'encode',
        rgba: original!.rgba,
        width: 800,
        height: 538,
        quality: 60,
      },
      []
    )
    expect(await resize({ bytes: webp.data }, 300)).toMatchObject({
      width: 300,
    })
  })

  it('JPEG 兜底编码可用；坏图返回 null', async () => {
    const image = await resize({ bytes: COVER }, 300)
    expect(sniffImage(await image!.jpeg(80))).toBe('jpeg')
    expect(
      await resize({ bytes: new Uint8Array([1, 2, 3, 4]) }, 300)
    ).toBeNull()
    expect(
      await resize({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }, 300)
    ).toBeNull()
  })
})
