/**
 * WebP 编解码线程（主进程的 worker_threads）：wasm 编解码放在独立线程，主进程事件循环不受影响。
 *
 * 消息：CodecRequest → CodecResponse。780 宽的海报编码约 50–120 ms。
 */
import { parentPort } from 'node:worker_threads'
import { loadWebpDecoder, loadWebpEncoder } from './webp-codec'

/** 编解码任务：encode 把 RGBA 编成 WebP，decode 把 WebP 解成 RGBA。 */
export type CodecJob =
  | {
      op: 'encode'
      rgba: Uint8Array
      width: number
      height: number
      quality: number
    }
  | { op: 'decode'; bytes: Uint8Array }

/** 编解码请求（带配对用的 id）。 */
export type CodecRequest = CodecJob & { id: number }

/** 编解码结果（decode 带宽高）。 */
export type CodecResponse =
  | { id: number; data: Uint8Array; width?: number; height?: number }
  | { id: number; error: string }

async function handle(request: CodecRequest): Promise<CodecResponse> {
  if (request.op === 'decode') {
    const image = await (await loadWebpDecoder())(request.bytes)
    return {
      id: request.id,
      data: image.rgba,
      width: image.width,
      height: image.height,
    }
  }
  const encode = await loadWebpEncoder()
  const data = await encode(
    request.rgba,
    request.width,
    request.height,
    request.quality
  )
  return { id: request.id, data }
}

parentPort?.on('message', async (request: CodecRequest) => {
  try {
    const response = await handle(request)
    const data = 'data' in response ? response.data : undefined
    parentPort!.postMessage(response, data ? [data.buffer as ArrayBuffer] : [])
  } catch (error) {
    const response: CodecResponse = {
      id: request.id,
      error: (error as Error).message || String(error),
    }
    parentPort!.postMessage(response)
  }
})
