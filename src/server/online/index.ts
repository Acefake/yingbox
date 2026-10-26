/**
 * 独立服务的在线板块：起引擎（engine.ts）、开引擎 API（rpc-route.ts）与播放代理（stream/route.ts）。
 * app.ts 只调 registerOnline 一次；YINGBOX_ONLINE=off 时什么都不登记，网页端在线板块显示不可用。
 * 配置见 config.ts，部署见 docs/library-server.md「在线播放」与 docs/deploy/nas.md。
 */
import type { Router } from '../http/router'
import { createNodeBrowserFetch } from './browser-fetch'
import { loadOnlineConfig } from './config'
import { type ServerEngine, createServerEngine } from './engine'
import { registerEngineRoutes } from './rpc-route'
import { registerStreamRoute } from './stream/route'

/** 依赖。 */
export interface OnlineDeps {
  dataDir: string
  env: NodeJS.ProcessEnv
  /** 当前 TMDB 令牌（服务密钥文件 → 环境变量），未配置为空串 */
  tmdbToken: () => string
  log: (message: string) => void
  /** 测试注入的引擎（缺省按配置 fork 子进程） */
  engine?: ServerEngine
}

/** 登记在线路由；返回关停函数（引擎收尾、关浏览器）。 */
export function registerOnline(
  router: Router,
  deps: OnlineDeps
): { close: () => Promise<void> } {
  const config = loadOnlineConfig(deps.env, deps.dataDir)
  if (!config.enabled) {
    deps.log('在线板块：已关闭（YINGBOX_ONLINE=off）')
    return { close: async () => {} }
  }
  const browser = createNodeBrowserFetch({
    spec: config.browser,
    dataDir: config.engineDir,
    log: message => deps.log(message),
  })
  const engine =
    deps.engine ??
    createServerEngine({
      config,
      browser,
      tmdbToken: deps.tmdbToken,
      log: deps.log,
    })
  registerEngineRoutes(router, engine)
  registerStreamRoute(router, { allowPrivate: config.streamAllowPrivate })
  const allowed = config.streamAllowPrivate.length
    ? `；播放代理放行内网 ${config.streamAllowPrivate.join('、')}`
    : ''
  deps.log(
    `在线板块：下载目录 ${config.downloadDir}；浏览器代抓 ${browser.describe()}${allowed}`
  )
  return { close: () => engine.shutdown() }
}
