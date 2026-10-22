/**
 * 让手动设置的 Referer 真正发出去（纯函数，不依赖 Electron）。
 *
 * Electron 的 net.fetch 走 Chromium 网络栈：请求头里自己写的 Referer 若与默认引用策略
 * （strict-origin-when-cross-origin）算出的不一致，会被网络服务当作 invalid referrer
 * 直接取消，报 net::ERR_BLOCKED_BY_CLIENT——豆瓣 rexxar、MissAV、防盗链图床都因此失败。
 * 带 Referer 时把 referrerPolicy 设为 unsafe-url 即可原样发出；Node fetch 忽略该字段。
 */

/** 请求头里是否有 Referer（不区分大小写） */
function hasReferer(headers: RequestInit['headers']): boolean {
  if (!headers) return false
  return new Headers(headers).has('referer')
}

/** 带 Referer 的请求补上 referrerPolicy: 'unsafe-url'；已显式指定策略的不动 */
export function withExplicitReferrer(init: RequestInit = {}): RequestInit {
  if (init.referrerPolicy || !hasReferer(init.headers)) return init
  return { ...init, referrerPolicy: 'unsafe-url' }
}
