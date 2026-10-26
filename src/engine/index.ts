/**
 * 后台引擎入口（桌面端 Electron utilityProcess）：组装见 boot.ts。
 *
 * 启动参数：argv[2] 为 userData 目录。出网用 Electron 的 Chromium 网络栈，组装见 engine-fetch.ts；
 * 主进程只做转发。
 */
import { lookup } from 'node:dns/promises'
import { net } from 'electron'
import { bootEngine } from './boot'
import { createEngineFetch } from './engine-fetch'

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
  fetch: createEngineFetch(net),
  lookup: host => lookup(host, { all: true }),
  exit: code => process.exit(code),
})
