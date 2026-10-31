import { isRemotePath } from '../../shared/webdav/remote-path'
/**
 * 媒体访问：海报 / 剧照缩略图与视频流。
 *
 * - /media/image/<key>[?w=]：媒体库已缓存的原图或缩略图，改写成 yingbox-media://image/ 交给缩略图管线；
 * - /media/thumb?w=&src=：远程图片（番号站点封面、演员头像）由服务代取、缩放，带防盗链 Referer，
 *   浏览器拿不到 Referer 的图床也能显示；只接受 http(s)（本地文件、插件协议不对网页开放）；
 * - /media/files/<id>：片库里登记过的视频文件，Range 流（网页端 <video> 播放）；
 * - POST /media/focus { urls } / POST /media/focus/save { url, focus }：海报取景的焦点，
 *   urls 是网页里 <img> 的上面两种地址，换成 yingbox-media:// 交给缩略图管线（与桌面端 IPC media 域相同）。
 */
import { serveFile } from '../../main/local-media'
import type { LibraryService } from '../../main/library/engine/service'
import type { ThumbnailPipeline } from '../../main/thumbnails/pipeline'
import { LIBRARY_HTTP } from '../../shared/library/ipc'
import { FOCUS_BATCH, parseFocus } from '../../shared/media-focus'
import { MEDIA_SCHEME } from '../../shared/media-url'
import { HttpError, type Router, fail, json, readJson } from '../http/router'

/** 依赖。 */
export interface MediaRouteDeps {
  remoteStream?: (path: string, request: Request) => Promise<Response>
  service: LibraryService
  thumbnails: ThumbnailPipeline
}

/** 改写成 yingbox-media:// 请求，带上协商缓存头。 */
function mediaRequest(url: string, request: Request): Request {
  const headers = new Headers()
  const etag = request.headers.get('if-none-match')
  if (etag) headers.set('if-none-match', etag)
  return new Request(url, { method: request.method, headers })
}

/**
 * 网页里的图片地址（/media/image/<key>?w=、/media/thumb?w=&src=http…）→ yingbox-media:// 地址；
 * 别的地址（含 thumb 的非 http(s) 来源）返回 null。
 */
export function toMediaUrl(url: URL): string | null {
  const width = url.searchParams.get('w')
  const w = width === null ? '' : `?w=${encodeURIComponent(width)}`
  if (url.pathname.startsWith(LIBRARY_HTTP.image)) {
    // key 是十六进制，地址里本来就不需要转义；带 / 或 % 的直接交给管线判 404
    const key = url.pathname.slice(LIBRARY_HTTP.image.length)
    return `${MEDIA_SCHEME}://image/${encodeURIComponent(key)}${w}`
  }
  if (url.pathname !== LIBRARY_HTTP.thumb) return null
  const src = url.searchParams.get('src') ?? ''
  if (!/^https?:\/\//i.test(src)) return null
  return `${MEDIA_SCHEME}://thumb/?w=${encodeURIComponent(width ?? '')}&src=${encodeURIComponent(src)}`
}

/** 请求体里的一个网页图片地址 → yingbox-media:// 地址（解析不了为空串，管线回 null）。 */
const fromPage = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  try {
    return toMediaUrl(new URL(value, 'http://page.invalid')) ?? ''
  } catch {
    return ''
  }
}

/** 登记媒体路由。 */
export function registerMediaRoutes(
  router: Router,
  deps: MediaRouteDeps
): void {
  router.add('GET', '/media/image/:key', (request, { url }) => {
    const target = toMediaUrl(url)
    if (!target) return fail(404, '没有这张图')
    return deps.thumbnails.handle(mediaRequest(target, request))
  })
  router.add('GET', '/media/thumb', (request, { url }) => {
    const target = toMediaUrl(url)
    if (!target) return fail(400, '只支持 http(s) 图片')
    return deps.thumbnails.handle(mediaRequest(target, request))
  })
  router.add('POST', LIBRARY_HTTP.focus, async request => {
    const body = (await readJson(request, 64 * 1024)) as { urls?: unknown }
    const urls = body?.urls
    if (!Array.isArray(urls) || urls.length > FOCUS_BATCH)
      throw new HttpError(400, `urls 应为最多 ${FOCUS_BATCH} 个地址的数组`)
    return json({ focus: await deps.thumbnails.focus.get(urls.map(fromPage)) })
  })
  router.add('POST', LIBRARY_HTTP.focusSave, async request => {
    const body = (await readJson(request, 4096)) as {
      url?: unknown
      focus?: unknown
    }
    const url = fromPage(body?.url)
    const focus = parseFocus(body?.focus)
    if (!url || !focus) throw new HttpError(400, '地址或焦点不合法')
    await deps.thumbnails.focus.save(url, focus)
    return new Response(null, { status: 204 })
  })
  router.add('GET', '/media/files/:id', async (request, { params }) => {
    const id = Number(params.id)
    const path = Number.isSafeInteger(id)
      ? deps.service.videoFilePath(id)
      : null
    if (!path) return fail(404, '文件不存在')
    if (isRemotePath(path)) {
      if (!deps.remoteStream) return fail(404, '远程播放不可用')
      try {
        return await deps.remoteStream(path, request)
      } catch (error) {
        return fail(502, (error as Error).message)
      }
    }
    return serveFile(path, request)
  })
}
