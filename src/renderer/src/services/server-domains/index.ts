/**
 * 网页端的契约域：`serverDomain('pan115')` 返回与 window.api.pan115 同形的对象，经同源的独立片库服务调用。
 * 桌面端不经过这里（有 preload）。实现见 client.ts。
 */
import { watch } from 'vue'
import type { Api } from '../../../../shared/contract'
import {
  isWebRuntime,
  libraryServerState,
  serverFetch,
} from '@/services/library-server'
import { createDomainClients } from './client'

let clients: ReturnType<typeof createDomainClients> | null = null

/**
 * 建 transport：服务没就绪（连不上 / 未登录）时关掉事件流，别让浏览器无限重连（就绪后断线照常自动重连）；
 * 服务回到在线时把还有订阅的事件流重新打开，网盘 / 追更事件不会就此断掉。
 */
function createWebDomainClients(): ReturnType<typeof createDomainClients> {
  const created = createDomainClients({
    request: serverFetch,
    openEvents: (url, onData, onClosed) => {
      const source = new EventSource(url, { withCredentials: true })
      source.onmessage = event => onData(String(event.data))
      source.onerror = () => {
        if (libraryServerState().value === 'online') return
        source.close()
        onClosed()
      }
      return source
    },
  })
  watch(libraryServerState(), state => {
    if (state === 'online') created.resume()
  })
  return created
}

/** 网页端某个域的客户端；不在网页端（桌面端或测试环境无 window）时为 undefined */
export function serverDomain<K extends keyof Api>(name: K): Api[K] | undefined {
  if (!isWebRuntime()) return undefined
  clients ??= createWebDomainClients()
  return clients.domain(name) as unknown as Api[K]
}
