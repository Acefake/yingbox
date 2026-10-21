/**
 * 桌面端缩放：Electron nativeImage（Skia，原生、几毫秒）。只在主进程可用（utilityProcess / Worker 里不行）。
 * nativeImage 只认 PNG / JPEG，WebP 原图先交编码线程用 wasm 解码。
 */
import { readFile } from 'node:fs/promises'
import { nativeImage } from 'electron'
import type { Codec } from './codec-client'
import { isWebp } from './sources'
import type { ImageResizer, OriginalImage } from './thumbnailer'

/** BGRA ↔ RGBA（交换 R / B，两个方向是同一个操作）。 */
function swapRedBlue(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = pixels[i + 2]
    out[i + 1] = pixels[i + 1]
    out[i + 2] = pixels[i]
    out[i + 3] = pixels[i + 3]
  }
  return out
}

/** nativeImage 缩放；codec 不可用时解不了 WebP 原图。 */
export function createNativeResizer(codec: Codec | undefined): ImageResizer {
  const decodeWebp = async (
    bytes: Uint8Array
  ): Promise<Electron.NativeImage> => {
    if (!codec || !isWebp(bytes)) return nativeImage.createEmpty()
    const copy = bytes.slice()
    const image = await codec({ op: 'decode', bytes: copy }, [
      copy.buffer as ArrayBuffer,
    ])
    // Skia 的 N32 像素格式在桌面平台上是 BGRA
    return nativeImage.createFromBitmap(Buffer.from(swapRedBlue(image.data)), {
      width: image.width!,
      height: image.height!,
    })
  }
  const open = async (
    original: OriginalImage
  ): Promise<Electron.NativeImage> => {
    const image =
      'path' in original
        ? nativeImage.createFromPath(original.path)
        : nativeImage.createFromBuffer(Buffer.from(original.bytes))
    if (!image.isEmpty()) return image
    return decodeWebp(
      'path' in original
        ? new Uint8Array(await readFile(original.path))
        : original.bytes
    )
  }
  return async (original, width) => {
    const image = await open(original)
    if (image.isEmpty()) return null
    const resized =
      image.getSize().width > width
        ? image.resize({ width, quality: 'better' })
        : image
    const size = resized.getSize()
    return {
      rgba: swapRedBlue(resized.toBitmap()),
      width: size.width,
      height: size.height,
      jpeg: quality => new Uint8Array(resized.toJPEG(quality)),
    }
  }
}
