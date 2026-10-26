/**
 * mpv 打开远程地址时的请求头：mpv 不经 Chromium 会话，防盗链 Referer 与线路自带的 UA / Referer 要自己带。
 * 直播线路的地址可能带 `|User-Agent=…&Referer=…`（见 shared/net/stream-headers），这里拆掉后缀，转成 mpv 选项。
 */
import { refererFor } from './media-headers'
import { splitStreamHeaders } from '../shared/net/stream-headers'
import type { MpvOpenOptions } from '../shared/mpv'

/** mpv 默认的 User-Agent（换文件时还原，免得上一条线路的 UA 留在进程里） */
const MPV_DEFAULT_UA = 'libmpv'

/** 打开目标与请求头：args 给新进程的命令行，props 给已运行进程换文件前设置 */
export function mpvStream(options: MpvOpenOptions): {
  target: string
  args: string[]
  props: Array<[name: string, value: string]>
} {
  if (options.filePath || !options.url)
    return {
      target: options.filePath || options.url || '',
      args: [],
      props: [],
    }
  const { url, headers } = splitStreamHeaders(options.url)
  const referer = headers?.referer ?? refererFor(url)
  const userAgent = headers?.userAgent
  return {
    target: url,
    args: [
      ...(referer ? [`--referrer=${referer}`] : []),
      ...(userAgent ? [`--user-agent=${userAgent}`] : []),
    ],
    props: [
      ['referrer', referer ?? ''],
      ['user-agent', userAgent ?? MPV_DEFAULT_UA],
    ],
  }
}
