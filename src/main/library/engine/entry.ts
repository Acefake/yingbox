/**
 * 引擎进程入口（Electron utilityProcess）——片库核心的桌面宿主。
 *
 * 启动参数：argv[2] 为数据库文件路径，argv[3] 为图片缓存目录。主进程经 parentPort 发 HostMessage：
 * request → 调服务并回 response；subscribe → 消息附带的 MessagePort 成为事件订阅方，
 * 之后事件直接经该端口推给渲染进程；shutdown → 关闭数据库后退出。
 *
 * 宿主能力（见 platform/platform.ts）：网络用 Electron net.fetch（Chromium 网络栈，走系统代理，
 * 国内访问 TMDB 通常需要），不可用时退回 Node fetch；原图落盘后通知主进程预热缩略图。
 * 独立服务（src/server）用同一个 createLibraryService，只是注入 Node 实现。
 */
import { type MessagePortMain, net } from 'electron'
import type { EngineMessage, HostMessage } from '../../../shared/library/ipc'
import { handleRpc } from './rpc'
import type { HttpFetch } from '../identify/identify-module'
import { createNodeFetch } from '../platform/fetch/node-fetch'
import { createLibraryService, envSecrets } from '../platform/platform'

const dbPath = process.argv[2]
const mediaDir = process.argv[3]
if (!dbPath) {
  console.error('[library] 缺少数据库路径参数')
  process.exit(1)
}

const parentPort = process.parentPort
const post = (message: EngineMessage): void => parentPort.postMessage(message)
const fetchImpl: HttpFetch =
  typeof net?.fetch === 'function'
    ? (((url, init) => net.fetch(url, init)) as HttpFetch)
    : createNodeFetch()
const service = createLibraryService({
  dbPath,
  mediaDir,
  fetch: fetchImpl,
  log: message => console.warn(`[library] ${message}`),
  onImagesCached: keys => post({ kind: 'images-cached', keys }),
  env: envSecrets(process.env),
})

/** 把一个 MessagePort 接成事件订阅方，端口关闭时自动退订。 */
function attachSubscriber(port: MessagePortMain): void {
  const unsubscribe = service.subscribe(event => port.postMessage(event))
  port.on('close', unsubscribe)
  port.start()
}

let shuttingDown = false
parentPort.on('message', ({ data, ports }) => {
  const message = data as HostMessage
  switch (message.kind) {
    case 'request':
      void handleRpc(service, message).then(post)
      break
    case 'subscribe':
      for (const port of ports) attachSubscriber(port)
      break
    case 'shutdown':
      if (shuttingDown) return
      shuttingDown = true
      void service.close().finally(() => process.exit(0))
      break
  }
})

service.start().then(
  () => post({ kind: 'ready' }),
  error => console.error('[library] 启动失败', error)
)
