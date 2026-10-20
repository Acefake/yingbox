/**
 * WebP 编码线程（主进程的 worker_threads）：编码放在独立线程，主进程事件循环不受影响。
 *
 * 消息：EncodeRequest → EncodeResponse。780 宽的海报编码约 50–120 ms。
 */
import { parentPort } from 'node:worker_threads'
import { loadWebpEncoder } from './webp-encoder'

/** 编码请求。 */
export interface EncodeRequest {
  id: number
  rgba: Uint8Array
  width: number
  height: number
  quality: number
}

/** 编码结果。 */
export type EncodeResponse =
  | { id: number; data: Uint8Array }
  | { id: number; error: string }

parentPort?.on('message', async (request: EncodeRequest) => {
  try {
    const encode = await loadWebpEncoder()
    const data = await encode(
      request.rgba,
      request.width,
      request.height,
      request.quality
    )
    const response: EncodeResponse = { id: request.id, data }
    parentPort!.postMessage(response, [data.buffer as ArrayBuffer])
  } catch (error) {
    const response: EncodeResponse = {
      id: request.id,
      error: (error as Error).message || String(error),
    }
    parentPort!.postMessage(response)
  }
})
