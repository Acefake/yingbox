/**
 * 非影视海报 / 封面的缩略图：<img> 用 thumbSrc() 拿 thumb:// 地址，挂载时调 ensureThumbnail()
 * 让 Worker 在缓存未命中时生成 WebP 并交给主进程落盘（流程见 src/shared/thumbs.ts）。
 *
 * Web/PWA（没有 window.api.thumbs）或来源不支持时，thumbSrc 原样返回原图地址，ensureThumbnail 什么都不做。
 */
import {
  type ThumbWidth,
  pickThumbWidth,
  thumbUrl,
} from '../../../../shared/thumbs'
import { type RunResult, type ThumbQueue, createThumbQueue } from './queue'

export { pickThumbWidth }

const available = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.api?.thumbs &&
  typeof OffscreenCanvas !== 'undefined'

/** <img> 的地址：可用时走 thumb://，否则原图 */
export function thumbSrc(source: string, width: ThumbWidth): string {
  return (available() && thumbUrl(source, width)) || source
}

let worker: Worker | null = null
let nextId = 0
const callbacks = new Map<
  number,
  { resolve: (r: RunResult) => void; reject: (e: Error) => void }
>()

function runInWorker(source: string, width: number): Promise<RunResult> {
  const url = thumbUrl(source, width as ThumbWidth)
  if (!url) return Promise.reject(new Error('来源不支持缩略图'))
  if (!worker) {
    worker = new Worker(new URL('./thumb.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent) => {
      const { id, hit, data, error } = event.data as {
        id: number
        hit?: boolean
        data?: ArrayBuffer
        error?: string
      }
      const callback = callbacks.get(id)
      callbacks.delete(id)
      if (!callback) return
      if (error || (!hit && !data))
        callback.reject(new Error(error || '空结果'))
      else callback.resolve(hit ? { hit: true } : { data: data! })
    }
  }
  const id = ++nextId
  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject })
    worker!.postMessage({ id, url, width })
  })
}

let queue: ThumbQueue | null = null

/** 确保这张缩略图已在磁盘缓存里（不阻塞显示；失败静默） */
export function ensureThumbnail(source: string, width: ThumbWidth): void {
  if (!available() || !thumbUrl(source, width)) return
  queue ??= createThumbQueue({
    run: runInWorker,
    // 队列里的宽度都来自本函数的 ThumbWidth 参数
    put: (src, w, data) => window.api.thumbs.put(src, w as ThumbWidth, data),
  })
  void queue.ensure(source, width)
}
