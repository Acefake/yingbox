/**
 * 主进程 ⇄ 引擎（utilityProcess）之间的消息格式。纯类型，两端共用。
 *
 * - call / result：主进程把已在 IPC 边界解析过的调用转给引擎，引擎回结果。
 * - event：引擎推契约事件，主进程原样广播给窗口。
 * - host / hostResult：引擎请主进程代办只有主进程能做的事（目前只有浏览器代抓）。
 */

/** 引擎能请主进程代办的事。 */
export interface HostMethods {
  /** 用 Chromium 窗口打开页面，等 Cloudflare 挑战结束后返回 HTML；失败返回空串。 */
  browserFetch(url: string, waitMs?: number): string
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
