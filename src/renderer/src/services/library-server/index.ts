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

import { LIBRARY_HTTP, type ServerHealth } from '../../../../shared/library/ipc'

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
  const token = url.searchParams.get('token')
  if (!token) return
  url.searchParams.delete('token')
  window.history.replaceState(window.history.state, '', url.toString())
  await loginLibraryServer(token).catch(() => {})
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
