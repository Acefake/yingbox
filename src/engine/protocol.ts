/**
 * 主进程 ⇄ 引擎（utilityProcess）之间的消息格式。纯类型，两端共用。
 *
 * - call / result：主进程把已在 IPC 边界解析过的调用转给引擎，引擎回结果。
 * - event：引擎推契约事件，主进程原样广播给窗口。
 * - host / hostResult：引擎请主进程代办只有主进程能做的事（浏览器代抓、读下载目录与 TMDB 令牌）。
 * - busy：引擎有调用之外的后台工作（下载在跑或排队）时报 true、做完报 false；
 *   主进程据此决定能否空闲退出引擎。
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

/** 主进程 → 引擎 */
export type ToEngine =
  | { kind: 'call'; id: number; channel: string; args: unknown[] }
  | {
      kind: 'hostResult'
      id: number
      ok: boolean
      value?: unknown
      error?: string
    }
  | { kind: 'shutdown' }

/** 引擎 → 主进程 */
export type FromEngine =
  | { kind: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  | { kind: 'event'; channel: string; payload: unknown }
  | {
      kind: 'host'
      id: number
      method: keyof HostMethods
      args: unknown[]
    }
  | { kind: 'busy'; busy: boolean }
