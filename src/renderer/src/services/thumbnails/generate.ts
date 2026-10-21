/**
 * Worker 里生成一张缩略图（依赖注入，测试时传替身）：
 * fetch thumb:// → 命中直接结束；未命中拿到原图 → createImageBitmap 下采样 → OffscreenCanvas → WebP。
 */
import { fitWidth } from '../../../../shared/thumbs'

/** 解码后的图（ImageBitmap 的最小外形） */
export interface Decoded {
  width: number
  height: number
  close(): void
}

export interface GenerateDeps<B extends Decoded = Decoded> {
  fetch(url: string): Promise<Response>
  /** 解码原图（拿到原始尺寸） */
  decode(blob: Blob): Promise<B>
  /** 把解码后的图下采样到目标尺寸并编码成 WebP */
  encode(bitmap: B, size: { width: number; height: number }): Promise<Blob>
}

export type GenerateResult = { hit: true } | { hit: false; data: ArrayBuffer }

/** WebP 质量：海报缩略图 0.8 肉眼与原图无差，体积约为 JPEG 原图的 1/5–1/10 */
export const WEBP_QUALITY = 0.8

export async function generateThumbnail<B extends Decoded>(
  url: string,
  width: number,
  deps: GenerateDeps<B>
): Promise<GenerateResult> {
  const response = await deps.fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (response.headers.get('x-thumb') === 'hit') {
    await response.body?.cancel().catch(() => {})
    return { hit: true }
  }
  const blob = await response.blob()
  const bitmap = await deps.decode(blob)
  let webp: Blob
  try {
    webp = await deps.encode(
      bitmap,
      fitWidth(bitmap.width, bitmap.height, width)
    )
  } finally {
    bitmap.close()
  }
  if (webp.type !== 'image/webp') throw new Error('浏览器不支持 WebP 编码')
  return { hit: false, data: await webp.arrayBuffer() }
}
