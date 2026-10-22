/**
 * 后台引擎入口（Electron utilityProcess）：在线、AV、下载三个域在这里实现。
 *
 * 启动参数：argv[2] 为 userData 目录。出网统一走 src/shared/net + Electron net.fetch
 * （Chromium 网络栈，TLS 指纹即真实 Chrome），主进程只做转发。
 */
import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import { net } from 'electron'
import { createNetClient } from '../shared/net/client'
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

const userData = process.argv[2]
if (!userData) {
  console.error('[engine] 缺少 userData 参数')
  process.exit(1)
}

const port: EnginePort = {
  postMessage: message => process.parentPort.postMessage(message),
  on: (_event, listener) =>
    process.parentPort.on('message', e => listener(e as never)),
}
const server = serveEngine(port)
const log = (line: string): void => console.warn(`[engine] ${line}`)

const httpClient = createNetClient({
  fetch: (url, init) => net.fetch(url, init),
  lookup: host => lookup(host, { all: true }),
})

server.implement(
  online,
  createOnlineHandlers({
    net: httpClient,
    loadPlugin: createPluginLoader(httpClient, join(userData, 'plugin-cache')),
    breaker: createPersistentBreaker(join(userData, 'online', 'breaker.json')),
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
void downloads.load()

// 模块加载完、各域注册好：主进程据此记录 fork → ready 的耗时
port.postMessage({ kind: 'ready' })

server.onShutdown(() => {
  downloads.queue.stop()
  void downloads.queue.flush().finally(() => process.exit(0))
})
