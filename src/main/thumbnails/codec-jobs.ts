/**
 * 图片编解码任务（纯 wasm，不依赖线程环境）：webp-worker.ts 在 worker_threads 里调用它；
 * 线程起不来时（或单测里）codec-client 的 inProcessCodec 直接在当前线程调用。
 *
 * - encode / decode：WebP 编码与解码（桌面端与独立服务都用）；
 * - resize / jpeg：纯 wasm 的解码 + 缩放与 JPEG 兜底编码，独立服务没有 nativeImage 时用（见 wasm-resizer.ts）。
 */
import { decodeImage, encodeJpeg, resizeToWidth } from './image-codec'
import { loadWebpDecoder, loadWebpEncoder } from './webp-codec'

/** 编解码任务。 */
export type CodecJob =
  | {
      /** RGBA → WebP */
      op: 'encode'
      rgba: Uint8Array
      width: number
      height: number
      quality: number
    }
  /** WebP → RGBA */
  | { op: 'decode'; bytes: Uint8Array }
  /** JPEG / PNG / WebP 原图 → 缩小到 width 的 RGBA（原图更窄时不放大） */
  | { op: 'resize'; bytes: Uint8Array; width: number }
  /** RGBA → JPEG */
  | {
      op: 'jpeg'
      rgba: Uint8Array
      width: number
      height: number
      quality: number
    }

/** 编解码请求（带配对用的 id）。 */
export type CodecRequest = CodecJob & { id: number }

/** 编解码结果（decode / resize 带宽高）。 */
export type CodecResponse =
  | { id: number; data: Uint8Array; width?: number; height?: number }
  | { id: number; error: string }

/** 执行一个编解码任务；失败抛错。 */
export async function runCodecJob(
  request: CodecRequest
): Promise<CodecResponse> {
  const { id } = request
  switch (request.op) {
    case 'decode': {
      const image = await (await loadWebpDecoder())(request.bytes)
      return { id, data: image.rgba, width: image.width, height: image.height }
    }
    case 'resize': {
      const image = await resizeToWidth(
        await decodeImage(request.bytes),
        request.width
      )
      return { id, data: image.rgba, width: image.width, height: image.height }
    }
    case 'jpeg':
      return { id, data: await encodeJpeg(request, request.quality) }
    case 'encode': {
      const encode = await loadWebpEncoder()
      const data = await encode(
        request.rgba,
        request.width,
        request.height,
        request.quality
      )
      return { id, data }
    }
  }
}
