/**
 * 媒体访问：海报 / 剧照缩略图与视频流。
 *
 * - /media/image/<key>[?w=]：媒体库已缓存的原图或缩略图，改写成 yingbox-media://image/ 交给缩略图管线；
 * - /media/thumb?w=&src=：远程图片（番号站点封面、演员头像）由服务代取、缩放，带防盗链 Referer，
 *   浏览器拿不到 Referer 的图床也能显示；只接受 http(s)（本地文件、插件协议不对网页开放）；
 * - /media/files/<id>：片库里登记过的视频文件，Range 流（网页端 <video> 播放）。
 */
import { serveFile } from '../../main/local-media'
import type { LibraryService } from '../../main/library/engine/service'
import type { ThumbnailPipeline } from '../../main/thumbnails/pipeline'
import { MEDIA_SCHEME } from '../../shared/media-url'
import { type Router, fail } from '../http/router'

/** 依赖。 */
export interface MediaRouteDeps {
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

/** 登记媒体路由。 */
export function registerMediaRoutes(
  router: Router,
  deps: MediaRouteDeps
): void {
  router.add('GET', '/media/image/:key', (request, { url, params }) => {
    const width = url.searchParams.get('w')
    const target = `${MEDIA_SCHEME}://image/${encodeURIComponent(params.key)}${width ? `?w=${encodeURIComponent(width)}` : ''}`
    return deps.thumbnails.handle(mediaRequest(target, request))
  })
  router.add('GET', '/media/thumb', (request, { url }) => {
    const src = url.searchParams.get('src') ?? ''
    if (!/^https?:\/\//i.test(src)) return fail(400, '只支持 http(s) 图片')
    const width = url.searchParams.get('w') ?? ''
    const target = `${MEDIA_SCHEME}://thumb/?w=${encodeURIComponent(width)}&src=${encodeURIComponent(src)}`
    return deps.thumbnails.handle(mediaRequest(target, request))
  })
  router.add('GET', '/media/files/:id', (request, { params }) => {
    const id = Number(params.id)
    const path = Number.isSafeInteger(id)
      ? deps.service.videoFilePath(id)
      : null
    if (!path) return fail(404, '文件不存在')
    return serveFile(path, request)
  })
}
