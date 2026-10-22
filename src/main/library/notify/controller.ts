/**
 * 外部变更通知端点的生命周期：按设置 library.notify.* 启停 / 重启 HTTP 端点，给出状态。
 * 不依赖 Electron（设置存储、引擎调用、端点启动都注入），单测直接用。
 *
 * - 打开时令牌为空就生成一个（32 个十六进制字符）写回设置；
 * - 局域网访问关：监听 127.0.0.1；开：监听 0.0.0.0，地址里写本机第一个局域网 IPv4；
 * - 端口被占用：换系统挑的空闲端口并写回设置，状态里的地址随之变化（CloudDrive2 那边要改一次）；
 * - apply 串行执行，配置没变不重启；收到的通知连同挂载目录设置转给媒体库引擎。
 */
import { randomBytes } from 'node:crypto'
import type { LibraryNotifyStatus } from '../../../shared/contract/library-notify'
import type {
  NotifyChangesRequest,
  NotifyChangesResult,
} from '../../../shared/library/ipc'
import type { SettingsStore } from '../../settings/store'
import {
  NOTIFY_PATH,
  type NotifyServer,
  type NotifyServerOptions,
  startNotifyServer,
} from './server'

/** 依赖。 */
export interface NotifyControllerDeps {
  store: Pick<SettingsStore, 'get' | 'set'>
  /** 转给媒体库引擎（notifyChanges）。 */
  notify: (request: NotifyChangesRequest) => Promise<NotifyChangesResult>
  /** 本机局域网 IPv4（地址展示用）；没有返回 undefined。 */
  lanAddress: () => string | undefined
  /** 启动端点（测试替换）。 */
  listen?: (options: NotifyServerOptions) => Promise<NotifyServer>
  /** 生成令牌（测试替换）。 */
  newToken?: () => string
  /** 状态变化。 */
  onStatus?: (status: LibraryNotifyStatus) => void
}

/** 端点控制器。 */
export interface NotifyController {
  status(): LibraryNotifyStatus
  /** 按当前设置启停 / 重启。 */
  apply(): Promise<LibraryNotifyStatus>
  /** 换新令牌并重启。 */
  resetToken(): Promise<LibraryNotifyStatus>
  close(): Promise<void>
}

const STOPPED: LibraryNotifyStatus = { running: false, url: null, error: null }

/** 创建控制器（不自动启动，调用方启动时调一次 apply）。 */
export function createNotifyController(
  deps: NotifyControllerDeps
): NotifyController {
  const listen = deps.listen ?? startNotifyServer
  const newToken = deps.newToken ?? (() => randomBytes(16).toString('hex'))
  let server: NotifyServer | null = null
  let running: { host: string; port: number; token: string } | null = null
  let current = STOPPED
  let chain: Promise<unknown> = Promise.resolve()

  const publish = (next: LibraryNotifyStatus): LibraryNotifyStatus => {
    current = next
    deps.onStatus?.(next)
    return next
  }

  const stop = async (): Promise<void> => {
    const closing = server
    server = running = null
    await closing?.close()
  }

  const start = async (
    host: string,
    port: number,
    token: string
  ): Promise<NotifyServer> => {
    const options: NotifyServerOptions = {
      host,
      port,
      token,
      onChanges: changes => {
        const mountRoot = deps.store.get('library.notify.mountRoot')
        return deps.notify(mountRoot ? { changes, mountRoot } : { changes })
      },
    }
    try {
      return await listen(options)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      return listen({ ...options, port: 0 })
    }
  }

  const sync = async (): Promise<LibraryNotifyStatus> => {
    const { store } = deps
    if (!store.get('library.notify.enabled')) {
      await stop()
      return current === STOPPED ? current : publish(STOPPED)
    }
    let token = store.get('library.notify.token')
    if (!token)
      token = store.set('library.notify.token', newToken()).value as string
    const lan = store.get('library.notify.lan')
    const host = lan ? '0.0.0.0' : '127.0.0.1'
    const port = store.get('library.notify.port')
    if (
      running &&
      running.host === host &&
      running.port === port &&
      running.token === token
    )
      return current
    await stop()
    try {
      server = await start(host, port, token)
    } catch (error) {
      return publish({ ...STOPPED, error: describeListenError(error, port) })
    }
    running = { host, port: server.port, token }
    if (server.port !== port) store.set('library.notify.port', server.port)
    const shown = lan ? (deps.lanAddress() ?? host) : host
    return publish({
      running: true,
      url: `http://${shown}:${server.port}${NOTIFY_PATH}?token=${token}`,
      error: null,
    })
  }

  /** 串行：上一次 apply 结束后再跑下一次。 */
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task)
    chain = next.catch(() => {})
    return next
  }

  return {
    status: () => current,
    apply: () => queued(sync),
    resetToken: () =>
      queued(() => {
        deps.store.set('library.notify.token', newToken())
        return sync()
      }),
    close: () => queued(stop),
  }
}

/** 启动失败 → 给人看的原因。 */
function describeListenError(error: unknown, port: number): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES') return `没有权限监听端口 ${port}`
  return `启动失败：${(error as Error).message}`
}
