/**
 * 主进程侧：按需启动引擎进程（utilityProcess），转发渲染进程的调用，转交事件订阅端口。
 *
 * 主进程不做媒体库计算，只做四件事：fork、按 id 配对请求与响应、把 MessagePort 交给引擎、
 * 把引擎「原图已下载」的通知转给缩略图服务预热（协议本身在 src/main/thumbnails）。
 * 引擎崩溃时挂起的调用以 engine-unavailable 失败，下一次调用自动重启引擎；
 * 缺依赖或连续秒退时不再重启（见 crash-guard.ts），之后的调用直接带原因失败。
 */
import { type UtilityProcess, app, ipcMain, utilityProcess } from 'electron'
import { join } from 'node:path'
import {
  type EngineMessage,
  type InvokeResult,
  LIBRARY_CHANNELS,
  type LibraryMethod,
  type LibraryRpcMap,
  type RpcError,
  isLibraryMethod,
} from '../../shared/library/ipc'
import type { ThumbnailService } from '../thumbnails'
import { CrashGuard } from './crash-guard'
import { libraryPaths } from './platform/paths'

/** 引擎数据目录。 */
const libraryDir = (): string => join(app.getPath('userData'), 'library')

const failure = (code: RpcError['code'], message: string): InvokeResult => ({
  ok: false,
  error: { code, message },
})

/** 引擎进程句柄。 */
class LibraryEngineHost {
  private child: UtilityProcess | undefined
  private readonly pending = new Map<number, (result: InvokeResult) => void>()
  private nextId = 1
  private readonly guard = new CrashGuard()

  constructor(private readonly thumbnails?: ThumbnailService) {}

  /** 确保引擎在运行；不该再重启时返回原因。 */
  private ensure(): UtilityProcess | string {
    if (this.child) return this.child
    const blocked = this.guard.blocked()
    if (blocked) return blocked
    const { dbPath, mediaDir } = libraryPaths(libraryDir())
    const child = utilityProcess.fork(
      join(__dirname, 'library-engine.js'),
      [dbPath, mediaDir],
      {
        serviceName: 'yingbox-library',
        // stderr 要过一遍崩溃守卫（认出缺依赖），再原样转到终端
        stdio: ['ignore', 'inherit', 'pipe'],
        // node:sqlite 在 Node 22 仍标记为实验特性，屏蔽每次启动的提示
        execArgv: ['--disable-warning=ExperimentalWarning'],
      }
    )
    this.guard.started()
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      this.guard.observe(chunk.toString('utf8'))
    })
    child.on('message', (message: EngineMessage) => this.onMessage(message))
    child.on('exit', code => {
      if (this.child === child) this.child = undefined
      this.guard.exited()
      const blocked = this.guard.blocked()
      if (blocked) console.error(`[library] ${blocked}`)
      const result = failure(
        'engine-unavailable',
        blocked ?? `媒体库引擎已退出（code ${code}）`
      )
      for (const settle of this.pending.values()) settle(result)
      this.pending.clear()
    })
    this.child = child
    return child
  }

  private onMessage(message: EngineMessage): void {
    if (message.kind === 'images-cached') {
      this.thumbnails?.warm(message.keys.filter(k => /^[0-9a-f]{32}$/.test(k)))
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
    if (typeof child === 'string') {
      return Promise.resolve(failure('engine-unavailable', child))
    }
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
    const child = this.ensure()
    if (typeof child === 'string') port.close()
    else child.postMessage({ kind: 'subscribe' }, [port])
  }

  /** 通知引擎关闭数据库并退出。 */
  shutdown(): void {
    this.child?.postMessage({ kind: 'shutdown' })
  }
}

/**
/** 主进程内直接调引擎（如下发 TMDB 令牌）；引擎报错时抛出。 */
export interface LibraryEngineClient {
  call<M extends LibraryMethod>(
    method: M,
    params: LibraryRpcMap[M]['params']
  ): Promise<LibraryRpcMap[M]['result']>
}

/**
 * 注册媒体库 IPC：library:invoke（调用）与 library:subscribe（事件端口）。
 * 须在 app ready 之后调用。返回主进程内用的调用口。
 */
export function registerLibraryIpc(
  thumbnails: ThumbnailService
): LibraryEngineClient {
  const host = new LibraryEngineHost(thumbnails)
  ipcMain.handle(
    LIBRARY_CHANNELS.invoke,
    (_event, method: unknown, params: unknown) => host.invoke(method, params)
  )
  ipcMain.on(LIBRARY_CHANNELS.subscribe, event => {
    const [port] = event.ports
    if (port) host.subscribe(port)
  })
  app.on('will-quit', () => host.shutdown())
  return {
    async call(method, params) {
      const response = await host.invoke(method, params)
      if (!response.ok) throw new Error(response.error.message)
      return response.result as never
    },
  }
}
