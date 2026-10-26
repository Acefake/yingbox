/**
 * 后台引擎（utilityProcess）的出网 fetch：Chromium 网络栈（TLS 指纹即真实 Chrome），带默认会话的 Cookie。
 *
 * shared/net/client 每一跳都用 `redirect: 'manual'`，Electron 37 的 net.fetch 不支持该模式，
 * 所以 manual 请求交给 net.request（与主进程播放代理同一个 manualRedirectFetch），其余交给 net.fetch。
 * 凭据用 `include`：会话 Cookie 照常收发（CF 挑战放行后的 cf_clearance、需要 Cookie 的 CMS / 插件源）。
 */
import type { FetchImpl } from '../shared/net/client'
import {
  type RequestFactory,
  manualRedirectFetch,
} from '../shared/net/manual-redirect-fetch'

/** 引擎用到的 electron `net` 子集（测试注入假实现） */
export interface EngineNet {
  request: RequestFactory
  fetch: FetchImpl
}

/**
 * 组装引擎的出网 fetch。
 * @param net electron 的 `net`
 */
export function createEngineFetch(net: EngineNet): FetchImpl {
  return manualRedirectFetch(
    options => net.request(options),
    (url, init) => net.fetch(url, init),
    { credentials: 'include' }
  )
}
