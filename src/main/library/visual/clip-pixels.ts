/**
 * 原图字节 → CLIP 输入像素（224×224 RGBA）：交给编解码线程（codec 的 clip 任务），不占引擎事件循环。
 */
import type { Codec } from '../../thumbnails/codec-client'
import { CLIP_IMAGE_SIZE } from './clip-encoder'

/** 用编解码线程实现像素转换。 */
export function codecClipPixels(
  codec: Codec
): (bytes: Uint8Array) => Promise<Uint8Array> {
  return async bytes => {
    const owned = bytes.slice()
    const out = await codec(
      { op: 'clip', bytes: owned, size: CLIP_IMAGE_SIZE },
      [owned.buffer as ArrayBuffer]
    )
    return out.data
  }
}
