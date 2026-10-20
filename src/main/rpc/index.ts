/**
 * 契约 → ipcMain 的通用注册器，以及主进程向渲染层推事件的唯一出口。
 *
 * 只有本目录与 src/preload 可以直接使用 ipcMain / ipcRenderer / webContents.send（lint 强制）。
 */
import { BrowserWindow, type WebContents, ipcMain } from 'electron'
import {
  type ArgsOf,
  ContractError,
  type Domain,
  type PayloadOf,
  type ResultOf,
  type SyncCall,
  type SyncReply,
  channelOf,
} from '../../shared/contract/define'

/** 一次调用的上下文：发起调用的渲染进程 */
export interface CallContext {
  sender: WebContents
}

/** 一个域的全部处理函数：键与契约一一对应，漏写或多写都编译失败 */
export type Handlers<D extends Domain> = {
  [K in keyof D['calls']]: (
    ctx: CallContext,
    ...args: ArgsOf<D['calls'][K]>
  ) => D['calls'][K] extends SyncCall<infer _A, infer R>
    ? R
    : ResultOf<D['calls'][K]> | Promise<ResultOf<D['calls'][K]>>
}

/** ipcMain 中注册器用到的那一小部分，测试可传入替身 */
export interface IpcHandleTarget {
  handle(
    channel: string,
    listener: (event: { sender: WebContents }, ...args: unknown[]) => unknown
  ): void
  on(
    channel: string,
    listener: (
      event: { sender: WebContents; returnValue: unknown },
      ...args: unknown[]
    ) => void
  ): void
}

/**
 * 按契约注册一个域的全部通道。
 *
 * 入参先经契约的 parse 在边界解析；不合法时抛出带通道名的错误（渲染层 invoke 被 reject），
 * 处理函数不会被调用。处理函数之后拿到的都是可信类型。
 */
export function implement<D extends Domain>(
  domain: D,
  handlers: Handlers<D>,
  ipc: IpcHandleTarget = ipcMain
): void {
  const table = handlers as Record<
    string,
    (ctx: CallContext, ...args: unknown[]) => unknown
  >
  for (const key of Object.keys(handlers)) {
    if (!(key in domain.calls))
      throw new Error(`[rpc] ${channelOf(domain.name, key)} 不在契约里`)
  }
  for (const key of Object.keys(domain.calls)) {
    if (typeof table[key] !== 'function')
      throw new Error(`[rpc] ${channelOf(domain.name, key)} 缺少实现`)
  }
  for (const [key, def] of Object.entries(domain.calls)) {
    const channel = channelOf(domain.name, key)
    const handler = table[key]
    const run = (sender: WebContents, raw: unknown[]): unknown => {
      let args: unknown[]
      try {
        args = def.parse(raw)
      } catch (error) {
        if (error instanceof ContractError)
          throw new Error(`[${channel}] ${error.message}`)
        throw error
      }
      return handler({ sender }, ...args)
    }
    if (def.kind === 'sync') {
      // sendSync 无法 reject：错误装进 SyncReply 带回，由 preload 在渲染层重新抛出
      ipc.on(channel, (event, ...raw) => {
        let reply: SyncReply
        try {
          reply = { ok: true, value: run(event.sender, raw) }
        } catch (error) {
          reply = { ok: false, error: (error as Error).message }
        }
        event.returnValue = reply
      })
    } else {
      ipc.handle(channel, (event, ...raw) => run(event.sender, raw))
    }
  }
}

/**
 * 推送契约里声明的事件。
 * 不传 to 时广播给所有窗口；传入时只发给该渲染进程。
 */
export function emit<D extends Domain, K extends keyof D['events'] & string>(
  domain: D,
  event: K,
  payload: PayloadOf<D['events'][K]>,
  to?: WebContents
): void {
  const channel = channelOf(domain.name, event)
  const targets = to
    ? [to]
    : BrowserWindow.getAllWindows().map(win => win.webContents)
  for (const target of targets) {
    if (!target.isDestroyed()) target.send(channel, payload)
  }
}
