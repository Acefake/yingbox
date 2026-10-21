/**
 * 图片编解码线程（worker_threads）：wasm 编解码放在独立线程，宿主进程的事件循环不受影响。
 * 消息：CodecRequest → CodecResponse，任务本身在 codec-jobs.ts。780 宽的海报编码约 50–120 ms。
 * 文件名沿用 webp-worker（构建入口与打包路径不变）。
 */
import { parentPort } from 'node:worker_threads'
import {
  type CodecRequest,
  type CodecResponse,
  runCodecJob,
} from './codec-jobs'

export type { CodecJob, CodecRequest, CodecResponse } from './codec-jobs'

parentPort?.on('message', async (request: CodecRequest) => {
  try {
    const response = await runCodecJob(request)
    const data = 'data' in response ? response.data : undefined
    // 结果可能是 wasm 内存的视图：复制成独立缓冲区再转移
    const owned =
      data && data.byteLength !== data.buffer.byteLength ? data.slice() : data
    const message = owned ? { ...response, data: owned } : response
    parentPort!.postMessage(message, owned ? [owned.buffer as ArrayBuffer] : [])
  } catch (error) {
    const response: CodecResponse = {
      id: request.id,
      error: (error as Error).message || String(error),
    }
    parentPort!.postMessage(response)
  }
})
