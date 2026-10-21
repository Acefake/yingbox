/**
 * 独立服务的缩放：解码（JPEG / PNG / WebP）、缩小、JPEG 兜底编码全在编解码线程里用 wasm 完成，
 * 没有原生依赖（不用 sharp：它的预编译二进制在部分 NAS 架构 / musl 上要现编，镜像也大得多）。
 * 780 宽海报一次约 100–250 ms，缩略图有磁盘缓存与预热，只在第一次生成时付出。
 */
import { readFile } from 'node:fs/promises'
import type { Codec, CodecResult } from './codec-client'
import type { ImageResizer, OriginalImage } from './thumbnailer'

/** 用编解码线程实现 ImageResizer；解不了的图返回 null。 */
export function createWasmResizer(codec: Codec): ImageResizer {
  const resize = async (
    original: OriginalImage,
    width: number
  ): Promise<CodecResult> => {
    const bytes =
      'path' in original
        ? new Uint8Array(await readFile(original.path))
        : original.bytes.slice()
    return codec({ op: 'resize', bytes, width }, [bytes.buffer as ArrayBuffer])
  }
  return async (original, width) => {
    let image: CodecResult
    try {
      image = await resize(original, width)
    } catch {
      return null
    }
    const size = { width: image.width!, height: image.height! }
    return {
      rgba: image.data,
      ...size,
      // 只在 WebP 编码失败时调用；那时 rgba 已转移给编码线程，重新缩放一次再编 JPEG
      jpeg: async quality => {
        const pixels =
          image.data.byteLength > 0
            ? image.data
            : (await resize(original, width)).data
        return (
          await codec({ op: 'jpeg', rgba: pixels, ...size, quality }, [
            pixels.buffer as ArrayBuffer,
          ])
        ).data
      },
    }
  }
}
