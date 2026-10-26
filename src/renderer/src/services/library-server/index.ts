/**
 * 网页端连接独立片库服务（src/server）：连接状态、登录、带鉴权的请求、媒体地址。
 *
 * 网页与服务同源（服务托管 dist-web，或 dev:web 经 vite 代理 /api、/media），
 * 鉴权靠服务写入的 HttpOnly Cookie：页面脚本拿不到令牌，<img> / <video> / EventSource 自动带上。
 * 桌面端（有 window.api）不经过这里，片库走 IPC。
 *
 * 这是渲染层唯一直接 fetch 的地方（eslint 豁免），只访问同源的片库服务。
 */
import { type Ref, ref } from 'vue'

import {
  LIBRARY_HTTP,
  type ServerHealth,
  type ServerSubtitle,
  type SubtitleListing,
} from '../../../../shared/library/ipc'
import type { MediaFocus } from '../../../../shared/media-focus'
import { tokenCandidates } from '../../../../shared/net/token-query'

/** 连接状态：未知（还没探测）/ 已连接 / 需要登录 / 连不上。 */
export type LibraryServerState =
  | 'unknown'
  | 'online'
  | 'unauthorized'
  | 'offline'

const state = ref<LibraryServerState>('unknown')
let probing: Promise<LibraryServerState> | null = null

/** 是否在网页端（没有 Electron preload）。 */
export function isWebRuntime(): boolean {
  return typeof window !== 'undefined' && !window.api
}

/** 连接状态（响应式，只读）；网页端第一次读取时开始探测。 */
export function libraryServerState(): Readonly<Ref<LibraryServerState>> {
  if (isWebRuntime()) void probeLibraryServer()
  return state
}

/** 同源请求；401 时把状态置为需要登录。网络错误原样抛出。 */
export async function serverFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
  })
  if (response.status === 401) state.value = 'unauthorized'
  return response
}

/** 探测服务（只探测一次，之后复用结果）；地址栏带 ?token= 时先用它登录。 */
export function probeLibraryServer(): Promise<LibraryServerState> {
  if (!isWebRuntime()) return Promise.resolve('offline')
  probing ??= (async () => {
    try {
      await loginFromUrl()
      const response = await fetch(LIBRARY_HTTP.health, {
        credentials: 'same-origin',
      })
      if (!response.ok) return (state.value = 'offline')
      const health = (await response.json()) as ServerHealth
      return (state.value = health.authorized ? 'online' : 'unauthorized')
    } catch {
      return (state.value = 'offline')
    }
  })()
  return probing
}

/**
 * 再探一次服务（事件流被浏览器放弃后用）：在线 / 需要登录时更新连接状态；连不上时不改状态（服务多半在重启），
 * 只返回 'offline'，由调用方过一会儿再探。
 */
export async function probeLibraryServerAgain(): Promise<
  Exclude<LibraryServerState, 'unknown'>
> {
  try {
    const response = await fetch(LIBRARY_HTTP.health, {
      credentials: 'same-origin',
    })
    if (!response.ok) return 'offline'
    const health = (await response.json()) as ServerHealth
    return (state.value = health.authorized ? 'online' : 'unauthorized')
  } catch {
    return 'offline'
  }
}

/** 用令牌登录（成功后服务写 Cookie）。令牌不对时抛错。 */
export async function loginLibraryServer(token: string): Promise<void> {
  const response = await fetch(LIBRARY_HTTP.session, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token.trim() }),
  })
  if (response.status === 401) throw new Error('令牌不正确')
  if (!response.ok) throw new Error(`登录失败（HTTP ${response.status}）`)
  state.value = 'online'
}

/**
 * 启动日志里的地址形如 http://host:port/?token=…：服务托管网页时由服务自己换成 Cookie，
 * 经 vite 代理（dev:web）时这里补做一次，然后从地址栏去掉令牌。
 */
async function loginFromUrl(): Promise<void> {
  const url = new URL(window.location.href)
  const candidates = tokenCandidates(url.search)
  if (!candidates.length) return
  url.searchParams.delete('token')
  window.history.replaceState(window.history.state, '', url.toString())
  for (const token of candidates) {
    const ok = await loginLibraryServer(token).then(
      () => true,
      () => false
    )
    if (ok) return
  }
}

/** 媒体库缓存图片（yingbox-media://image/<key>）在服务上的地址。 */
export function serverImageUrl(key: string, width?: number): string {
  return `${LIBRARY_HTTP.image}${key}${width ? `?w=${width}` : ''}`
}

/** 远程图片经服务代取并缩放的地址（带防盗链 Referer，手机上也省流量）。 */
export function serverThumbUrl(source: string, width: number): string {
  return `${LIBRARY_HTTP.thumb}?w=${width}&src=${encodeURIComponent(source)}`
}

/** 片库视频文件的流地址（支持 Range）。 */
export function serverFileUrl(fileId: number): string {
  return `${LIBRARY_HTTP.file}${fileId}`
}

/** 播放地址里的片库视频文件 id（serverFileUrl 给出的地址，相对或绝对都认）；不是时为 null。 */
export function serverFileIdOf(source: string): number | null {
  let path: string
  try {
    path = new URL(source, 'http://page.invalid').pathname
  } catch {
    return null
  }
  if (!path.startsWith(LIBRARY_HTTP.file)) return null
  const id = Number(path.slice(LIBRARY_HTTP.file.length))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 是否是服务给出的字幕地址（serverSubtitles 返回的 url）。 */
export const isServerSubtitleUrl = (url: string): boolean =>
  url.startsWith(LIBRARY_HTTP.subtitles)

/** 视频旁的外挂字幕（同名优先）；失败时抛错。 */
export async function serverSubtitles(
  fileId: number
): Promise<ServerSubtitle[]> {
  const response = await serverFetch(`${LIBRARY_HTTP.subtitles}${fileId}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ((await response.json()) as SubtitleListing).subtitles
}

/** 读一条外挂字幕（服务已转成 WebVTT）；失败时抛错。 */
export async function serverSubtitleVtt(url: string): Promise<string> {
  if (!isServerSubtitleUrl(url)) throw new Error('不是片库字幕地址')
  const response = await serverFetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

/** 海报取景的焦点（urls 是 serverImageUrl / serverThumbUrl 给出的地址）；失败时抛错。 */
export async function serverFocus(
  urls: string[]
): Promise<Array<MediaFocus | null>> {
  const response = await serverFetch(LIBRARY_HTTP.focus, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ((await response.json()) as { focus: Array<MediaFocus | null> }).focus
}

/** 写回人脸检测的焦点；失败时抛错。 */
export async function serverSaveFocus(
  url: string,
  focus: MediaFocus
): Promise<void> {
  const response = await serverFetch(LIBRARY_HTTP.focusSave, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, focus }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
