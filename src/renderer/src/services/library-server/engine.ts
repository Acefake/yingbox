/**
 * 网页端访问独立服务上的在线引擎（online / av / download 域）：transport 见 engine-bridge.ts。
 * 桌面端（有 window.api）不经过这里。
 */
import type { Domain, DomainApi } from '../../../../shared/contract/define'
import { streamProxyPath } from '../../../../shared/engine-http'
import { type EngineBridge, createEngineBridge } from './engine-bridge'
import { isWebRuntime, libraryServerState, serverFetch } from './index'

let bridge: EngineBridge | null = null
const apis = new Map<string, unknown>()

/** 网页端的引擎域 API；桌面端返回 null。 */
export function webEngineApi<D extends Domain>(domain: D): DomainApi<D> | null {
  if (!isWebRuntime()) return null
  bridge ??= createEngineBridge({
    request: serverFetch,
    openEvents: (url, onData) => {
      const source = new EventSource(url, { withCredentials: true })
      source.onmessage = event => onData(String(event.data))
      // 服务没就绪（连不上 / 未登录）时别无限重连；就绪后断线照常自动重连
      source.onerror = () => {
        if (libraryServerState().value !== 'online') source.close()
      }
      return source
    },
  })
  let api = apis.get(domain.name) as DomainApi<D> | undefined
  if (!api) {
    api = bridge.api(domain)
    apis.set(domain.name, api)
  }
  return api
}

/**
 * 网页端播放远程媒体的地址：别的源的 http(s) 地址经服务的 /api/stream 代理（带防盗链头、m3u8 改写、Range），
 * 同源地址（片库 /media/files、已经代理过的）与 blob: / data: 原样返回。桌面端原样返回。
 */
export function webPlayableUrl(url: string): string {
  if (!isWebRuntime() || !url) return url
  let target: URL
  try {
    target = new URL(url, window.location.href)
  } catch {
    return url
  }
  if (!['http:', 'https:'].includes(target.protocol)) return url
  if (target.origin === window.location.origin) return url
  return streamProxyPath(target.href)
}
