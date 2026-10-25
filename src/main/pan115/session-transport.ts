/**
 * 115 传输层的 Electron 实现：独立分区 persist:pan115。
 *
 * - Cookie：登录 Cookie 由 useCookie 写进该分区（会话 Cookie，不设过期，不落盘）；
 *   权威来源仍是 safeStorage 里的 pan115.session，启动时由服务恢复、退出时清掉。
 * - Referer：请求上带并设 referrerPolicy: 'unsafe-url'（with115Init）；UA：请求上带，且该分区的
 *   onBeforeSendHeaders 对 115 域统一覆盖（见 transport.ts 里的实测说明）。
 * - 请求走该分区的 session.fetch，credentials: 'include' 带上分区 Cookie。
 */
import type { Session } from 'electron'

import {
  PAN115_URL_PATTERNS,
  type Pan115Transport,
  cookieDetails,
  with115Headers,
  with115Init,
} from './transport'

/** 115 专用分区 */
export const PAN115_PARTITION = 'persist:pan115'

/** 分区传输层；clear 清掉分区里的全部 Cookie */
export interface SessionTransport extends Pan115Transport {
  clear(): Promise<void>
}

/**
 * 在一个 session 上建 115 传输层（装 onBeforeSendHeaders，每个 session 只应建一次）。
 * @param target 分区 session（正式用 session.fromPartition(PAN115_PARTITION)）
 * @param origin 写 Cookie 用的地址；正式为 https://115.com，自检脚本用 http 回显时传 http://115.com
 */
export function createSessionTransport(
  target: Session,
  origin = 'https://115.com'
): SessionTransport {
  target.webRequest.onBeforeSendHeaders(
    { urls: PAN115_URL_PATTERNS },
    (details, callback) =>
      callback({
        requestHeaders: with115Headers(details.url, details.requestHeaders),
      })
  )

  async function clear(): Promise<void> {
    await target.clearStorageData({ storages: ['cookies'] })
  }

  return {
    fetch: (url, init) =>
      target.fetch(url, { ...with115Init(url, init), credentials: 'include' }),
    async useCookie(cookie) {
      await clear()
      if (!cookie) return
      for (const details of cookieDetails(cookie, origin))
        await target.cookies.set(details)
    },
    clear,
  }
}
