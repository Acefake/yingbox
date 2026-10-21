/**
 * 编解码线程的客户端：启动 webp-worker、按 id 配对请求与结果（宿主无关，桌面端与独立服务共用）。
 * inProcessCodec 在当前线程直接执行同样的任务：线程起不来时的兜底，也给单测用。
 */
import { Worker } from 'node:worker_threads'
import { type CodecJob, type CodecResponse, runCodecJob } from './codec-jobs'

/** 编解码成功的结果（decode / resize 带宽高）。 */
export type CodecResult = Extract<CodecResponse, { data: Uint8Array }>

/** 向编解码线程发一个请求；transfer 里的缓冲区转移给线程。 */
export type Codec = (
  request: CodecJob,
  transfer: ArrayBuffer[]
) => Promise<CodecResult>

/** 启动编解码线程；线程起不来时返回 undefined（调用方退回不编码 WebP）。 */
export function startCodec(
  workerPath: string,
  log: (message: string) => void
): Codec | undefined {
  let worker: Worker
  try {
    worker = new Worker(workerPath)
  } catch (error) {
    log(`图片编解码线程启动失败：${(error as Error).message}`)
    return undefined
  }
  worker.unref()
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (r: CodecResult) => void; reject: (e: Error) => void }
  >()
  worker.on('message', (message: CodecResponse) => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if ('data' in message) entry.resolve(message)
    else entry.reject(new Error(message.error))
  })
  let dead: Error | undefined
  const failAll = (error: Error): void => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  worker.on('error', error => {
    log(`图片编解码线程出错：${error.message}`)
    failAll(error)
  })
  // 线程退出后不再派活，之前在途的请求一并失败（否则会永远等下去）
  worker.on('exit', code => {
    dead = new Error(`图片编解码线程已退出（code ${code}）`)
    failAll(dead)
  })
  return (request, transfer) =>
    new Promise((resolve, reject) => {
      if (dead) {
        reject(dead)
        return
      }
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...request, id }, transfer)
    })
}

/** 在当前线程执行编解码（会占用事件循环，只作兜底与测试用）。 */
export function inProcessCodec(): Codec {
  let nextId = 1
  return async request => {
    const response = await runCodecJob({ ...request, id: nextId++ })
    if (!('data' in response)) throw new Error(response.error)
    return response
  }
}
