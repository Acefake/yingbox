/**
 * 主进程侧：按需启动引擎进程（utilityProcess），转发渲染进程的调用，转交事件订阅端口。
 *
 * 主进程不做任何媒体库计算，只做三件事：fork、按 id 配对请求与响应、把 MessagePort 交给引擎。
 * 引擎崩溃时挂起的调用以 engine-unavailable 失败，下一次调用自动重启引擎。
 */
import { type UtilityProcess, app, ipcMain, utilityProcess } from 'electron'
import { join } from 'node:path'
import {
  type EngineMessage,
  type InvokeResult,
  LIBRARY_CHANNELS,
  type RpcError,
  isLibraryMethod,
} from '../../shared/library/ipc'

const failure = (code: RpcError['code'], message: string): InvokeResult => ({
  ok: false,
  error: { code, message },
})

/** 引擎进程句柄。 */
class LibraryEngineHost {
  private child: UtilityProcess | undefined
  private readonly pending = new Map<number, (result: InvokeResult) => void>()
  private nextId = 1

  /** 确保引擎在运行。 */
  private ensure(): UtilityProcess {
    if (this.child) return this.child
    const dbPath = join(app.getPath('userData'), 'library', 'library.db')
    const child = utilityProcess.fork(
      join(__dirname, 'library-engine.js'),
      [dbPath],
      {
        serviceName: 'yingbox-library',
        stdio: 'inherit',
        // node:sqlite 在 Node 22 仍标记为实验特性，屏蔽每次启动的提示
        execArgv: ['--disable-warning=ExperimentalWarning'],
      }
    )
    child.on('message', (message: EngineMessage) => this.onMessage(message))
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
    return child
  }

  private onMessage(message: EngineMessage): void {
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
      child.postMessage({
        kind: 'request',
        id,
        method,
        params,
      })
    })
  }

  /** 把渲染进程的 MessagePort 交给引擎作为事件订阅方。 */
  subscribe(port: Electron.MessagePortMain): void {
    this.ensure().postMessage({ kind: 'subscribe' }, [port])
  }

  /** 通知引擎关闭数据库并退出。 */
  shutdown(): void {
    this.child?.postMessage({ kind: 'shutdown' })
  }
}

/** 注册媒体库 IPC：library:invoke（调用）与 library:subscribe（事件端口）。 */
export function registerLibraryIpc(): void {
  const host = new LibraryEngineHost()
  ipcMain.handle(
    LIBRARY_CHANNELS.invoke,
    (_event, method: unknown, params: unknown) => host.invoke(method, params)
  )
  ipcMain.on(LIBRARY_CHANNELS.subscribe, event => {
    const [port] = event.ports
    if (port) host.subscribe(port)
  })
  app.on('will-quit', () => host.shutdown())
}
