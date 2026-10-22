/**
 * 在线引擎的主进程能力表：引擎经线协议的 host / reply（shared/utility/protocol.ts）请主进程代办。
 * 纯类型，两端共用。
 */

/** 引擎能请主进程代办的事。 */
export interface HostMethods {
  /** 用 Chromium 窗口打开页面，等 Cloudflare 挑战结束后返回 HTML；失败返回空串。 */
  browserFetch(url: string, waitMs?: number): string
  /** 解除浏览器代抓的主机熔断；不给主机则全部解除 */
  resetBrowserFetch(host?: string): void
  /** 当前下载目录（用户设置，可能随时改变） */
  downloadDir(): string
  /** 当前生效的 TMDB 令牌（明文只在主进程与引擎之间传，不经渲染层）；未配置为空串 */
  tmdbToken(): string
}
