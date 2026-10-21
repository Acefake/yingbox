/**
 * 缩略图 Worker：在后台线程解码、缩放、编码，主线程不卡。
 * 消息：{ id, url, width } → { id, hit } | { id, data } | { id, error }
 */
import { WEBP_QUALITY, generateThumbnail } from './generate'

interface Request {
  id: number
  url: string
  width: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

const deps = {
  // 只请求 thumb://（主进程代取原图），不直连外网
  // eslint-disable-next-line no-restricted-globals
  fetch: (url: string) => fetch(url),
  decode: (blob: Blob) => createImageBitmap(blob),
  // 从已解码的图再下采样，不重复解码原图
  encode: async (
    source: ImageBitmap,
    size: { width: number; height: number }
  ) => {
    const bitmap = await createImageBitmap(source, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    })
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OffscreenCanvas 不可用')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY })
  },
}

scope.onmessage = async event => {
  const { id, url, width } = event.data
  try {
    const result = await generateThumbnail(url, width, deps)
    if (result.hit) scope.postMessage({ id, hit: true })
    else scope.postMessage({ id, data: result.data }, [result.data])
  } catch (error) {
    scope.postMessage({ id, error: (error as Error).message })
  }
}
