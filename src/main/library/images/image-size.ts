/**
 * 只读图片文件头拿宽高（JPEG / PNG / GIF / WebP），不解码像素。
 *
 * 番号站点自带的竖版海报清晰度差别很大：DMM 的 ps.jpg 只有 147×200，有的站给的是原生高清图。
 * 刮削时先探一下站点海报的尺寸，够清楚就直接用，不够才从封面裁（见 derived.ts）。
 * 探测用 Range 只取文件开头一段，服务器不支持 Range 时也只读到够解析为止。
 */
import { refererFor } from '../../../shared/net/media-referer'
import type { BinaryFetch } from './image-cache'
import { parseDerived } from './derived'
import { isPlaceholderImage } from '../../../shared/net/placeholder-image'

/** 图片尺寸。 */
export interface ImageSize {
  width: number
  height: number
}

/** 探测时最多读多少字节（JPEG 的 SOF 偶尔排在大块 EXIF / ICC 之后）。 */
const PROBE_BYTES = 256 * 1024

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number): number =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.subarray(from, to))

/** JPEG：逐段跳过，读第一个 SOF 段（C0–CF，除 C4 DHT / C8 / CC DAC）。 */
function jpegSize(b: Uint8Array): ImageSize | undefined {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    const length = u16be(b, i + 2)
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (sof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
    i += 2 + length
  }
  return undefined
}

/** WebP：VP8（有损）、VP8L（无损）、VP8X（扩展）三种块头。 */
function webpSize(b: Uint8Array): ImageSize | undefined {
  const chunk = ascii(b, 12, 16)
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  }
  return undefined
}

/** 从文件开头的字节里读宽高；认不出或字节不够返回 undefined。 */
export function imageSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 10) return undefined
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b)
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b.length >= 24) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (ascii(b, 0, 4) === 'GIF8')
    return { width: u16le(b, 6), height: u16le(b, 8) }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')
    return webpSize(b)
  return undefined
}

/** 探测远程图片尺寸；失败（网络、非图片）返回 undefined。 */
export type ImageProbe = (
  url: string,
  signal?: AbortSignal
) => Promise<ImageSize | undefined>

/** 用宿主的 fetch 实现探测；结果按地址记在内存里（同一张海报批量刮削时只探一次）。 */
export function createImageProbe(fetch: BinaryFetch, limit = 500): ImageProbe {
  const known = new Map<string, ImageSize | undefined>()
  return async (url, signal) => {
    if (known.has(url)) return known.get(url)
    const source = parseDerived(url).source
    const referer = refererFor(source)
    let size: ImageSize | undefined
    try {
      const timeout = AbortSignal.timeout(15_000)
      const response = await fetch(source, {
        headers: {
          Range: `bytes=0-${PROBE_BYTES - 1}`,
          ...(referer ? { Referer: referer } : {}),
        },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      const real = response.status === 200 || response.status === 206
      if (real && !isPlaceholderImage(response.url)) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        size = imageSize(bytes.subarray(0, PROBE_BYTES))
      }
    } catch (error) {
      if (signal?.aborted) throw error
    }
    if (known.size >= limit) known.delete(known.keys().next().value as string)
    known.set(url, size)
    return size
  }
}
