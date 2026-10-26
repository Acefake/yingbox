/**
 * 后台引擎入口（桌面端 Electron utilityProcess）：组装见 boot.ts。
 *
 * 启动参数：argv[2] 为 userData 目录。出网用 Electron 的 Chromium 网络栈（TLS 指纹即真实 Chrome），主进程只做转发。
 * shared/net/client 每一跳都用 `redirect: 'manual'`，而 Electron 37 的 net.fetch 遇到它直接抛
 * Redirect was cancelled，所以经 manualRedirectFetch 改走 net.request（与主进程的播放代理同一个实现）。
 */
import { lookup } from 'node:dns/promises'
import { net } from 'electron'
import { manualRedirectFetch } from '../main/manual-redirect-fetch'
import { bootEngine } from './boot'

const userData = process.argv[2]
if (!userData) {
  console.error('[engine] 缺少 userData 参数')
  process.exit(1)
}

bootEngine({
  port: {
    postMessage: message => process.parentPort.postMessage(message),
    on: (_event, listener) =>
      process.parentPort.on('message', e => listener(e as never)),
  },
  userData,
  fetch: manualRedirectFetch(
    options => net.request(options),
    (url, init) => net.fetch(url, init),
    { credentials: 'include' }
  ),
  lookup: host => lookup(host, { all: true }),
  exit: code => process.exit(code),
})
