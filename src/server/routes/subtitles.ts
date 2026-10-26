/**
 * 外挂字幕（网页播放器自动挂载用，对应桌面端 IPC subtitle:find / subtitle:read）：
 *
 * - GET /media/subtitles/<fileId>：片库视频文件旁的字幕（srt / ass / ssa / vtt / sub），同名优先；
 *   只返回文件名和读取地址，不暴露服务端路径；
 * - GET /media/subtitles/<fileId>/<文件名>：读一条字幕，统一转成 WebVTT（含 GBK / UTF-16 解码）。
 *   文件名必须在上一条接口给出的列表里，读不到视频目录以外的文件。
 *
 * 文件定位、编码判断与格式转换与桌面端共用 src/main/subtitle.ts。
 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { LibraryService } from '../../main/library/engine/service'
import { findSubtitleFiles, readSubtitleAsVtt } from '../../main/subtitle'
import { LIBRARY_HTTP, type SubtitleListing } from '../../shared/library/ipc'
import { type Router, fail, json } from '../http/router'

/** 单个字幕文件的大小上限（正常字幕远小于这个值）。 */
export const SUBTITLE_MAX_BYTES = 8 * 1024 * 1024

/** 视频文件 id → 路径；不认识的 id 为 null。 */
function videoPath(service: LibraryService, raw: string): string | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? service.videoFilePath(id) : null
}

/** 一条字幕的读取地址。 */
export const subtitleUrl = (fileId: string, fileName: string): string =>
  `${LIBRARY_HTTP.subtitles}${fileId}/${encodeURIComponent(fileName)}`

/** 登记字幕路由。 */
export function registerSubtitleRoutes(
  router: Router,
  service: LibraryService
): void {
  router.add('GET', `${LIBRARY_HTTP.subtitles}:id`, async (_r, { params }) => {
    const path = videoPath(service, params.id)
    if (!path) return fail(404, '文件不存在')
    const found = await findSubtitleFiles(path)
    const listing: SubtitleListing = {
      subtitles: found.map(item => ({
        name: item.name,
        ext: item.ext,
        url: subtitleUrl(params.id, basename(item.path)),
      })),
    }
    return json(listing)
  })

  router.add(
    'GET',
    `${LIBRARY_HTTP.subtitles}:id/:name`,
    async (_r, { params }) => {
      const path = videoPath(service, params.id)
      if (!path) return fail(404, '文件不存在')
      const match = (await findSubtitleFiles(path)).find(
        item => basename(item.path) === params.name
      )
      if (!match) return fail(404, '没有这条字幕')
      const info = await stat(match.path).catch(() => null)
      if (!info) return fail(404, '没有这条字幕')
      if (info.size > SUBTITLE_MAX_BYTES) return fail(413, '字幕文件过大')
      const read = await readSubtitleAsVtt(match.path)
      if (!read.success || read.data === undefined)
        return fail(500, read.error ?? '字幕读取失败')
      return new Response(read.data, {
        headers: {
          'Content-Type': 'text/vtt; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }
  )
}
