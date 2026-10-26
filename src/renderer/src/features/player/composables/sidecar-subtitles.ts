/**
 * 视频旁外挂字幕的来源，两边都交回 WebVTT 文本：
 * - 桌面端：local:// 视频经 IPC subtitle:find / subtitle:read（主进程读文件、解码、转 WebVTT）；
 * - 网页端：片库服务的视频（/media/files/<id>）经 /media/subtitles 接口，候选的 path 是服务给的读取地址。
 * 其它来源（在线播放的 http 地址）没有外挂字幕。
 */
import {
  isServerSubtitleUrl,
  serverFileIdOf,
  serverSubtitleVtt,
  serverSubtitles,
} from '@/services/library-server'

/** 外挂字幕候选（同目录 .srt/.ass/.vtt；网页端 path 是服务的读取地址）。 */
export interface LocalSubtitle {
  name: string
  path: string
  ext: string
}

/** 找视频旁的字幕，同名优先；找不到或来源不支持时为空数组。网络 / IPC 错误原样抛出。 */
export async function findSidecarSubtitles(
  source: string
): Promise<LocalSubtitle[]> {
  const api = window.api?.subtitle
  if (api) {
    if (!source.startsWith('local://')) return []
    const found = await api.find(source)
    return found?.success && Array.isArray(found.data) ? found.data : []
  }
  const fileId = serverFileIdOf(source)
  if (fileId === null) return []
  const list = await serverSubtitles(fileId)
  return list.map(item => ({ name: item.name, path: item.url, ext: item.ext }))
}

/** 读一条字幕成 WebVTT；读不出为 null。 */
export async function readSidecarSubtitle(
  path: string
): Promise<string | null> {
  // 网页端才认服务地址：桌面端的本地路径也可能以 /media/ 开头（Linux 挂载点）
  if (!window.api)
    return isServerSubtitleUrl(path) ? serverSubtitleVtt(path) : null
  const read = await window.api.subtitle?.read(path)
  return read?.success && read.data ? read.data : null
}
