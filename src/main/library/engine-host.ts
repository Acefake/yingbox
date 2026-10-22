/**
 * 媒体库引擎宿主（与 Electron 无关的部分）：按需 fork 引擎、按 id 配对请求与响应、
 * 为每个订阅事件的渲染进程窗口接一条直达引擎的 MessagePort。
 *
 * 事件端口由主进程创建并持有订阅方名单，而不是由渲染进程建好端口交过来：端口的一端在引擎里，
 * 引擎崩溃时它随进程一起失效。宿主每次 fork 新引擎都给名单里的每个窗口重新建一条通道，
 * 一端随 subscribe 发给引擎、另一端经 library:port 发给窗口，所以重启后事件照常到达。
 * 新端口在转发任何调用之前发出，触发重启的那次调用产生的事件也不会丢。
 *
 * 引擎崩溃时挂起的调用以 engine-unavailable 失败；下一次调用（或新的订阅）才重启引擎，
 * 不会因为有订阅方就在崩溃后立即重启，避免启动即崩时反复 fork。
 */
import type {
  EngineMessage,
  HostMessage,
  InvokeResult,
  RpcError,
  RpcRequest,
} from '../../shared/library/ipc'
import { isLibraryMethod } from '../../shared/library/ipc'

/** 引擎子进程句柄的最小形状（Electron UtilityProcess 的子集）。 */
export interface LibraryChild {
  postMessage(message: HostMessage, transfer?: unknown[]): void
  on(event: 'message', listener: (message: EngineMessage) => void): void
  on(event: 'exit', listener: (code: number) => void): void
}

/** 一条事件通道：port1 交给引擎，port2 交给订阅窗口（Electron MessageChannelMain 的子集）。 */
export interface LibraryEventChannel {
  port1: unknown
  port2: unknown
}

/** 一个订阅事件的窗口：deliver 把通道的窗口端交过去（主进程里是 webContents.postMessage）。 */
export interface LibrarySubscriber {
  deliver(port: unknown): void
}

/** 宿主依赖：fork 引擎、建事件通道、处理「原图已下载」通知。 */
export interface LibraryHostDeps {
  fork(): LibraryChild
  createChannel(): LibraryEventChannel
  onImagesCached?(keys: string[]): void
}

const failure = (code: RpcError['code'], message: string): InvokeResult => ({
  ok: false,
  error: { code, message },
})

/** 媒体库引擎宿主。 */
export class LibraryEngineHost {
  private child: LibraryChild | undefined
  private readonly pending = new Map<number, (result: InvokeResult) => void>()
  /** 订阅方名单，键由调用方给（主进程里是 webContents.id）。 */
  private readonly subscribers = new Map<number, LibrarySubscriber>()
  private nextId = 1

  constructor(private readonly deps: LibraryHostDeps) {}

  /** 引擎是否在运行。 */
  get running(): boolean {
    return this.child !== undefined
  }

  /** 确保引擎在运行；新 fork 的引擎先给全部订阅方接上事件通道。 */
  private ensure(): LibraryChild {
    if (this.child) return this.child
    const child = this.deps.fork()
    child.on('message', message => this.onMessage(message))
    child.on('exit', code => {
      if (this.child === child) this.child = undefined
      const result = failure(
        'engine-unavailable',
        `媒体库引擎已退出（code ${code}）`
      )
      for (const settle of this.pending.values()) settle(result)
      this.pending.clear()
    })
    this.child = child
    for (const subscriber of this.subscribers.values()) {
      this.connect(child, subscriber)
    }
    return child
  }

  /** 新建一条通道，一端交给引擎作为事件订阅方，另一端交给窗口。 */
  private connect(child: LibraryChild, subscriber: LibrarySubscriber): void {
    const { port1, port2 } = this.deps.createChannel()
    child.postMessage({ kind: 'subscribe' }, [port1])
    subscriber.deliver(port2)
  }

  private onMessage(message: EngineMessage): void {
    if (message.kind === 'images-cached') {
      this.deps.onImagesCached?.(message.keys)
      return
    }
    if (message.kind !== 'response') return
    const settle = this.pending.get(message.id)
    if (!settle) return
    this.pending.delete(message.id)
    settle(
      message.ok
        ? { ok: true, result: message.result }
        : { ok: false, error: message.error }
    )
  }

  /** 转发一次调用。方法名不在白名单内直接拒绝，参数由引擎解析。 */
  invoke(method: unknown, params: unknown): Promise<InvokeResult> {
    if (!isLibraryMethod(method)) {
      return Promise.resolve(
        failure('unknown-method', `未知方法：${String(method)}`)
      )
    }
    const child = this.ensure()
    const id = this.nextId++
    return new Promise(resolve => {
      this.pending.set(id, resolve)
      // 参数在引擎内由 handleRpc 解析（同一份解析被 HTTP 服务复用），这里原样转发
      child.postMessage({
        kind: 'request',
        id,
        method,
        params: params as RpcRequest['params'],
      })
    })
  }

  /**
   * 登记（或替换）一个订阅方并立即给它接一条通道。同一个键再次订阅（如窗口刷新后）
   * 会替换旧的登记；旧通道的窗口端随旧页面关闭，引擎端随之退订。
   */
  subscribe(key: number, subscriber: LibrarySubscriber): void {
    const running = this.child
    this.subscribers.set(key, subscriber)
    if (running) this.connect(running, subscriber)
    else this.ensure()
  }

  /** 移除订阅方：之后引擎重启不再给它发端口。已发出的端口由窗口自己关闭。 */
  unsubscribe(key: number): void {
    this.subscribers.delete(key)
  }

  /** 通知引擎关闭数据库并退出。 */
  shutdown(): void {
    this.child?.postMessage({ kind: 'shutdown' })
  }
}
