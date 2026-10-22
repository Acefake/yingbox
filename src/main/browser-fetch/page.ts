import { classifyPage } from '../../shared/net/cf-page'

/**
 * 浏览器代抓两条路（窗口渲染、会话直取）共用的会话身份与页面判定。
 *
 * cf_clearance 绑定 UA 与出口 IP：两条路必须用同一个 partition、同一个 UA，
 * 窗口过挑战拿到的 cookie 才能被会话直取带上并被 Cloudflare 认可。
 */

/** 代抓统一使用的 UA（窗口与会话直取一致）。 */
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 固定 partition：cf_clearance 等 cookie 跨请求、跨重启保留。 */
export const PARTITION = 'persist:yingbox-browser-fetch'

/** 页面可用 = 不是挑战/封锁页，且有真实文档内容（避免把空白/失败页当成成功）。 */
export const isUsablePage = (html: string): boolean =>
  typeof html === 'string' &&
  html.length >= 500 &&
  html.includes('<body') &&
  classifyPage(html) === 'ok'

/** 硬封锁：浏览器也过不去。 */
export class BlockedPageError extends Error {
  constructor(readonly url: string) {
    super(`blocked: ${url}`)
  }
}
