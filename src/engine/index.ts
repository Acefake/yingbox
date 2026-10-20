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
import { online } from '../shared/contract/online'
import { createAvHandlers } from './av'
import { createOnlineHandlers } from './online'
import { createPluginLoader } from './online/plugin-cache'
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
    log,
  })
)

server.implement(av, createAvHandlers(httpClient))

server.onShutdown(() => process.exit(0))
