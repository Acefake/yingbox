/**
 * 后台引擎入口（独立服务 / NAS：child_process.fork）：组装与桌面端相同（boot.ts），差别只在宿主。
 *
 * - 消息：process.send / process.on('message')，fork 时用 serialization: 'advanced'（结构化克隆，
 *   与 utilityProcess 一致，undefined 参数不会变成 null）；
 * - 出网：Node fetch（undici）。被 Cloudflare 拦下时经宿主 browserFetch 代抓（服务端可选 Chromium，
 *   没配置时返回空串，引擎按失败降级）。
 *
 * 启动参数：argv[2] 为引擎数据目录。宿主见 src/server/online/engine.ts。
 */
import { lookup } from 'node:dns/promises'
import type { FromUtility, ToUtility } from '../shared/utility/protocol'
import { bootEngine } from './boot'

const userData = process.argv[2]
if (!userData || typeof process.send !== 'function') {
  console.error('[engine] 缺少数据目录参数，或不是经 fork 启动')
  process.exit(1)
}

const send = process.send.bind(process) as (message: FromUtility) => boolean

// 宿主断开（服务退出 / 被 kill）时自行退出，不留孤儿进程
process.on('disconnect', () => process.exit(0))

bootEngine({
  port: {
    postMessage: message => void send(message),
    on: (_event, listener) =>
      process.on('message', data => listener({ data: data as ToUtility })),
  },
  userData,
  fetch: (url, init) => fetch(url, init),
  lookup: host => lookup(host, { all: true }),
  exit: code => process.exit(code),
})
