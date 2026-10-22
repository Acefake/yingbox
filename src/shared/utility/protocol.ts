/**
 * 主进程 ⇄ utilityProcess 子进程（在线引擎 yingbox-engine、媒体库引擎 yingbox-library）的线协议。
 * 纯类型，两端共用；各自的方法表（在线引擎的契约通道与主进程能力 HostMethods、媒体库的
 * LibraryRpcMap）不在这里。
 *
 * - call / result：主进程转发一次调用，子进程回结果。method 是在线引擎的契约通道名
 *   （如 online:search）或媒体库的方法名（如 listLibraries）；媒体库的参数是 args[0]。
 * - ready：子进程初始化完成（主进程只记录 fork → ready 的耗时，调用不等它）。
 * - event：子进程推事件。在线引擎的事件由主进程广播给窗口；媒体库只用它发
 *   library:images-cached（原图已下载，主进程据此预热缩略图），渲染层的事件走订阅端口。
 * - host / reply：子进程请主进程代办只有主进程能做的事（浏览器代抓、读下载目录与 TMDB 令牌）。
 * - busy：子进程有调用之外的后台工作（下载在跑或排队）时报 true、做完报 false；
 *   主进程据此决定能否空闲退出。
 * - subscribe：消息附带的 MessagePort 是一个新的事件订阅方（媒体库）。
 * - shutdown：收尾后自行退出；超时主进程会 kill。
 */

/** 可序列化的错误；code 供调用方分支（如媒体库的 not-found），message 给人看。 */
export interface UtilityError {
  code?: string
  message: string
}

/** 一次调用或代办的结果。 */
export type UtilityOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: UtilityError }

/** 主进程 → 子进程。 */
export type ToUtility =
  | { kind: 'call'; id: number; method: string; args: unknown[] }
  | ({ kind: 'reply'; id: number } & UtilityOutcome)
  | { kind: 'subscribe' }
  | { kind: 'shutdown' }

/** 子进程 → 主进程。 */
export type FromUtility =
  | ({ kind: 'result'; id: number } & UtilityOutcome)
  | { kind: 'ready' }
  | { kind: 'event'; channel: string; payload: unknown }
  | { kind: 'host'; id: number; method: string; args: unknown[] }
  | { kind: 'busy'; busy: boolean }
