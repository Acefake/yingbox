/**
 * 后台引擎的组装：在线、AV、下载三个域在这里注册，与宿主无关。
 *
 * 两个入口共用它，只在「怎么收发消息、用什么出网」上不同：
 * - index.ts：桌面端 Electron utilityProcess（parentPort + net.fetch，Chromium 网络栈）；
 * - node.ts：独立服务的 child_process（process.send + Node fetch），见 src/server/online。
 * 出网统一走 src/shared/net（SSRF 防护、逐跳重定向），宿主能力（浏览器代抓、下载目录、TMDB 令牌）
 * 经线协议的 host / reply 请宿主代办。
 */
import { join } from 'node:path'
import type { LookupAll } from '../shared/net/guard'
import { type FetchImpl, createNetClient } from '../shared/net/client'
import { av } from '../shared/contract/av'
import { download } from '../shared/contract/download'
import { online } from '../shared/contract/online'
import { createAvHandlers } from './av'
import { createDownloadHandlers } from './download'
import { createOnlineHandlers } from './online'
import { createPersistentBreaker } from './online/breaker-store'
import { createPluginLoader } from './online/plugin-cache'
import { createPluginStorage } from './online/plugin-storage'
import { createDoubanTrailers } from './online/douban-trailer'
import { type EnginePort, serveEngine } from './rpc'

/** 引擎的宿主差异。 */
export interface EngineBootOptions {
  /** 与宿主之间的消息端口 */
  port: EnginePort
  /** 数据目录（插件缓存、熔断记录、下载队列都在它下面） */
  userData: string
  /** 底层 fetch（必须支持 redirect: 'manual' 返回 3xx 原响应） */
  fetch: FetchImpl
  lookup: LookupAll
  /** 收尾完成后退出进程 */
  exit: (code: number) => void
}

/** 启动好的引擎。 */
export interface BootedEngine {
  /** 收尾（停下载、写回队列）后退出进程；宿主的 shutdown 消息与宿主断开都走这里，只执行一次 */
  shutdown(): Promise<void>
}

/** 注册三个域、恢复下载队列，并告诉宿主已就绪。 */
export function bootEngine(options: EngineBootOptions): BootedEngine {
  const { port, userData } = options
  const server = serveEngine(port)
  const log = (line: string): void => console.warn(`[engine] ${line}`)
  const httpClient = createNetClient({
    fetch: options.fetch,
    lookup: options.lookup,
  })

  server.implement(
    online,
    createOnlineHandlers({
      net: httpClient,
      loadPlugin: createPluginLoader(
        httpClient,
        join(userData, 'plugin-cache')
      ),
      breaker: createPersistentBreaker(
        join(userData, 'online', 'breaker.json')
      ),
      pluginStorage: createPluginStorage({
        dir: join(userData, 'online', 'plugin-storage'),
      }),
      doubanTrailers: createDoubanTrailers({
        net: httpClient,
        file: join(userData, 'online', 'douban-trailers.json'),
      }),
      log,
    })
  )

  server.implement(av, createAvHandlers(httpClient))

  const downloads = createDownloadHandlers({
    net: httpClient,
    stateFile: join(userData, 'downloads', 'queue.json'),
    ctx: server.context,
  })
  server.implement(download, downloads.handlers)
  // 下载域的调用会等队列读盘完成；这里只兜住意外的拒绝，不让引擎进程因未处理的 rejection 退出
  downloads
    .load()
    .catch(error => console.error('[download] 恢复下载队列失败', error))

  // 模块加载完、各域注册好：宿主据此记录 fork → ready 的耗时
  port.postMessage({ kind: 'ready' })

  let closing: Promise<void> | undefined
  const shutdown = (): Promise<void> =>
    (closing ??= (async () => {
      downloads.queue.stop()
      await downloads.queue
        .flush()
        .catch(error => console.error('[download] 写回下载队列失败', error))
      options.exit(0)
    })())
  server.onShutdown(() => void shutdown())
  return { shutdown }
}
