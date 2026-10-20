/**
 * Amane API 转发：白名单内的 JSON 请求、amane:// 图片协议、媒体 ID → 本地路径。
 */
import { promises as fs } from 'fs'
import type { AmaneRequest } from '../../../shared/amane'
import { connection, fetchApi } from './connection'
import { readAmaneResponse } from './response'
import {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  isAguiPath,
  isImageResourcePath,
  mediaPathFor,
  permittedPath,
  requestTimeoutFor,
} from './rules'

/** 转发一次请求，返回解析后的 JSON；非 2xx 时抛出带 detail 的错误 */
export async function requestApi(request: AmaneRequest): Promise<unknown> {
  const path = permittedPath(request, connection.settings.baseUrl)
  const body =
    request.body === undefined ? undefined : JSON.stringify(request.body)
  if (body && Buffer.byteLength(body) > MAX_REQUEST_BYTES)
    throw new Error('请求内容过大')
  const response = await fetchApi(path, {
    method: request.method || 'GET',
    body,
    signal: AbortSignal.timeout(requestTimeoutFor(path)),
  })
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES)
    throw new Error('Amane 响应过大，请缩小查询范围')
  if (response.ok && isAguiPath(path)) {
    // Turns run independently of the subscription; the Vue client follows durable trace rows.
    await response.body?.cancel()
    return { accepted: true }
  }
  return readAmaneResponse(response, path)
}

/** amane://image/?path=… 协议处理：只取资源图片，限 16 MB */
export async function imageResponse(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).searchParams.get('path') || ''
    if (!isImageResourcePath(path)) return new Response(null, { status: 400 })
    const response = await fetchApi(path)
    if (!response.ok) return new Response(null, { status: response.status })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/'))
      return new Response(null, { status: 415 })
    const reader = response.body?.getReader()
    if (!reader) return new Response(null, { status: 502 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return new Response(null, { status: 413 })
      }
      chunks.push(value)
    }
    return new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}

/** Playback paths are resolved from indexed media, never supplied as arbitrary IPC arguments. */
export async function resolveAmaneMedia(mediaId: number): Promise<string> {
  if (!Number.isSafeInteger(mediaId) || mediaId < 1)
    throw new Error('无效的媒体文件')
  const media = (await requestApi({ path: `/api/media/${mediaId}` })) as {
    path: string
    library_id: number
  }
  const library = (await requestApi({
    path: `/api/libraries/${media.library_id}`,
  })) as { path: string }
  const path = mediaPathFor(media.path, library.path)
  const stat = await fs.stat(path)
  if (!stat.isFile()) throw new Error('关联的视频文件不存在')
  return path
}
