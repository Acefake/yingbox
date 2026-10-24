/**
 * 媒体库引擎宿主（与 Electron 无关的部分）：按需 fork 引擎、按 id 配对请求与响应、
 * 为每个订阅事件的渲染进程窗口接一条直达引擎的 MessagePort。
 *
 * 事件端口由主进程创建并持有订阅方名单，而不是由渲染进程建好端口交过来：端口的一端在引擎里，
 * 引擎崩溃时它随进程一起失效。宿主每次 fork 新引擎都给名单里的每个窗口重新建一条通道，
 * 一端随 subscribe 发给引擎、另一端经 library:port 发给窗口，所以重启后事件照常到达。
 * 新端口在转发任何调用之前发出，触发重启的那次调用产生的事件也不会丢。
 *
 * 进程生命周期由 UtilityHost（main/utility/host.ts）负责：引擎崩溃时挂起的调用以
 * engine-unavailable 失败；下一次调用（或新的订阅）才重启引擎，不会因为有订阅方就在崩溃后
 * 立即重启，避免启动即崩时反复 fork。关停超时 kill；媒体库引擎不空闲退出（目录监控要常驻）。
 */
import {
  type InvokeResult,
  LIBRARY_IMAGES_CACHED,
  type LibraryErrorCode,
  isLibraryMethod,
} from '../../shared/library/ipc'
import {
  UtilityCallError,
  type UtilityChild,
  UtilityHost,
  type UtilityHostOptions,
} from '../utility/host'

/** 引擎子进程句柄（Electron UtilityProcess 的子集）。 */
export type LibraryChild = UtilityChild

/** 一条事件通道：port1 交给引擎，port2 交给订阅窗口（Electron MessageChannelMain 的子集）。 */
export interface LibraryEventChannel {
  port1: unknown
  port2: unknown
}

/** 一个订阅事件的窗口：deliver 把通道的窗口端交过去（主进程里是 webContents.postMessage）。 */
export interface LibrarySubscriber {
  deliver(port: unknown): void
}

/** 宿主依赖：fork 引擎、建事件通道、处理「原图已下载」通知、引擎就绪。 */
export interface LibraryHostDeps {
  fork(): LibraryChild
  createChannel(): LibraryEventChannel
  onImagesCached?(keys: string[]): void
  /** 引擎初始化完成（数据库已打开）；elapsedMs 为 fork → ready 的耗时 */
  onReady?(elapsedMs: number): void
  /** 崩溃守卫停止重启（缺依赖 / 连续秒退）时，带原因调用一次 */
  onBlocked?(reason: string): void
  /** 关停超时，默认 UtilityHost 的 5 秒 */
  stopTimeoutMs?: number
  /** 引擎能请主进程代办的事（如远程源凭据 webdavAccess） */
  host?: UtilityHostOptions['host']
}

const failure = (code: LibraryErrorCode, message: string): InvokeResult => ({
  ok: false,
  error: { code, message },
})

/** 媒体库引擎宿主：生命周期交给 UtilityHost，这里只管订阅方名单与错误码。 */
export class LibraryEngineHost {
  private readonly utility: UtilityHost
  /** 订阅方名单，键由调用方给（主进程里是 webContents.id）。 */
  private readonly subscribers = new Map<number, LibrarySubscriber>()

  constructor(private readonly deps: LibraryHostDeps) {
    this.utility = new UtilityHost({
      name: '媒体库引擎',
      fork: deps.fork,
      stopTimeoutMs: deps.stopTimeoutMs,
      onReady: deps.onReady,
      onBlocked: deps.onBlocked,
      host: deps.host,
      // 新 fork 的引擎先给全部订阅方接上事件通道，再转发任何调用
      onStart: child => {
        for (const subscriber of this.subscribers.values()) {
          this.connect(child, subscriber)
        }
      },
      onEvent: (channel, payload) => {
        if (channel === LIBRARY_IMAGES_CACHED)
          deps.onImagesCached?.(payload as string[])
      },
    })
  }

  /** 引擎是否在运行。 */
  get running(): boolean {
    return this.utility.running
  }

  /** 新建一条通道，一端交给引擎作为事件订阅方，另一端交给窗口。 */
  private connect(child: LibraryChild, subscriber: LibrarySubscriber): void {
    const { port1, port2 } = this.deps.createChannel()
    child.postMessage({ kind: 'subscribe' }, [port1])
    subscriber.deliver(port2)
  }

  /**
   * 转发一次调用。方法名不在白名单内直接拒绝，参数在引擎内由 handleRpc 解析（同一份解析被
   * HTTP 服务复用），这里原样转发。错误以数据返回：引擎崩溃 / 关停为 engine-unavailable。
   */
  async invoke(method: unknown, params: unknown): Promise<InvokeResult> {
    if (!isLibraryMethod(method)) {
      return failure('unknown-method', `未知方法：${String(method)}`)
    }
    try {
      const result = await this.utility.call(method, [params])
      return { ok: true, result }
    } catch (error) {
      const { message, code } = error as UtilityCallError
      return failure(
        code === 'unavailable' || !code
          ? 'engine-unavailable'
          : (code as LibraryErrorCode),
        message
      )
    }
  }

  /**
   * 登记（或替换）一个订阅方并立即给它接一条通道。同一个键再次订阅（如窗口刷新后）
   * 会替换旧的登记；旧通道的窗口端随旧页面关闭，引擎端随之退订。
   */
  subscribe(key: number, subscriber: LibrarySubscriber): void {
    const running = this.utility.current
    this.subscribers.set(key, subscriber)
    if (running) this.connect(running, subscriber)
    else this.utility.start() // 新进程 fork 后由 onStart 接通道
  }

  /** 移除订阅方：之后引擎重启不再给它发端口。已发出的端口由窗口自己关闭。 */
  unsubscribe(key: number): void {
    this.subscribers.delete(key)
  }

  /** 通知引擎关闭数据库并退出；超时 kill。 */
  shutdown(): Promise<void> {
    return this.utility.stop()
  }
}
