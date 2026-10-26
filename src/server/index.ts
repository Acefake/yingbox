/**
 * 影盒片库服务入口：`node out/server/server.js [--host 0.0.0.0] [--port 31480] [--data-dir …] [--media-root …]`
 *
 * 片库 + 刮削核心以 Node 宿主独立运行，给网页端（以及 NAS / Docker）用；桌面端不经过这里。
 * 配置见 config.ts，对外监听的门槛见 exposure.ts，接口见 shared/library/ipc/contract-http.ts，
 * 部署见 docs/library-server.md 与 docs/deploy/nas.md。
 */
import { createServer } from 'node:http'
import { describeFetch } from '../main/library/platform/fetch'
import { createServerApp } from './app'
import { describeMonitor, loadConfig } from './config'
import { exposureProblem } from './exposure'
import { createNodeListener } from './http/adapter'

const log = (message: string): void => console.log(`[yingbox] ${message}`)

/** 启动日志里给人看的地址（监听所有地址时提示用本机 IP 访问）。 */
function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '<本机IP>'
  return host.includes(':') ? `[${host}]` : host
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2), process.env)
  // 对外监听要显式令牌（ADR-0010）：在打开数据库、生成令牌之前拦下
  const problem = exposureProblem(config.host, process.env)
  if (problem) throw new Error(problem)
  const app = await createServerApp(config, {
    log: message => console.warn(`[yingbox] ${message}`),
  })
  const server = createServer(createNodeListener(app.fetch, log))
  // SSE 是长连接：不让 Node 的默认请求超时掐断它
  server.requestTimeout = 0
  server.headersTimeout = 60_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })
  const address = server.address()
  const port =
    typeof address === 'object' && address ? address.port : config.port
  const base = `http://${displayHost(config.host)}:${port}`
  log(`片库服务已启动：${base}`)
  log(`数据目录：${config.dataDir}`)
  if (config.cacheDir !== config.dataDir) log(`缓存目录：${config.cacheDir}`)
  log(`媒体根目录：${config.mediaRoots.join('、')}`)
  log(`出网：${describeFetch(config.fetch)}`)
  log(`目录监控：${describeMonitor(config.monitor)}`)
  log(
    config.webDir
      ? `网页端：${base}/?token=${encodeURIComponent(app.token)}${app.tokenGenerated ? '（新生成的令牌）' : ''}`
      : `未托管网页端（没有 dist-web）；API 令牌：${app.token}`
  )

  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    log(`收到 ${signal}，正在关闭…`)
    server.close()
    server.closeAllConnections()
    void app.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(error => {
  console.error(
    '[yingbox] 启动失败：',
    error instanceof Error ? error.message : error
  )
  process.exit(1)
})
