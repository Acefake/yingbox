/**
 * 主进程侧：把媒体库引擎宿主（engine-host.ts）接到 Electron——utilityProcess.fork、
 * MessageChannelMain、library:* 三条 IPC 通道、「原图已下载」转给缩略图服务预热，
 * 以及替引擎代办 AI 调用（ai-host.ts）。
 *
 * 主进程不做媒体库计算。事件订阅：窗口发 library:subscribe 登记，主进程建通道，一端给引擎、
 * 一端经 library:port 推给窗口；引擎重启后自动给每个登记的窗口重新推一次端口。
 */
import { MessageChannelMain, app, ipcMain, utilityProcess } from 'electron'
import { join } from 'node:path'
import {
  LIBRARY_CHANNELS,
  type LibraryMethod,
  type LibraryRpcMap,
} from '../../shared/library/ipc'
import type { ThumbnailService } from '../thumbnails'
import { libraryAiHost } from './ai-host'
import { libraryToolsHost } from './tools-host'
import {
  type LibraryChild,
  LibraryEngineHost,
  type LibraryHostDeps,
} from './engine-host'
import { libraryPaths } from './platform/paths'

/** 引擎数据目录。 */
const libraryDir = (): string => join(app.getPath('userData'), 'library')

/** 启动引擎进程。 */
function forkEngine(): LibraryChild {
  const { dbPath, mediaDir } = libraryPaths(libraryDir())
  return utilityProcess.fork(
    join(__dirname, 'library-engine.js'),
    [dbPath, mediaDir],
    {
      serviceName: 'yingbox-library',
      // stderr 先过崩溃守卫（认出缺依赖），再原样转到终端
      stdio: ['ignore', 'inherit', 'pipe'],
      // node:sqlite 在 Node 22 仍标记为实验特性，屏蔽每次启动的提示
      execArgv: ['--disable-warning=ExperimentalWarning'],
    }
  ) as unknown as LibraryChild
}

/** 主进程内直接调引擎（如下发 TMDB 令牌）；引擎报错时抛出。 */
export interface LibraryEngineClient {
  call<M extends LibraryMethod>(
    method: M,
    params: LibraryRpcMap[M]['params']
  ): Promise<LibraryRpcMap[M]['result']>
}

/**
 * 注册媒体库 IPC：library:invoke（调用）、library:subscribe / library:unsubscribe（事件订阅登记）。
 * 须在 app ready 之后调用。hostMethods 是引擎能请主进程代办的事（远程源凭据），AI 识别兜底（ai-host.ts）与 ffprobe 定位（tools-host.ts）的代办总会加上。返回主进程内用的调用口。
 */
export function registerLibraryIpc(
  thumbnails: ThumbnailService,
  hostMethods?: LibraryHostDeps['host']
): LibraryEngineClient {
  const host = new LibraryEngineHost({
    // 代办：调用方给的（远程源凭据）+ 引擎里的 AI 识别兜底经主进程的 aiService 调大模型
    host: { ...libraryAiHost(), ...libraryToolsHost(), ...hostMethods },
    fork: forkEngine,
    createChannel: () => new MessageChannelMain(),
    onImagesCached: keys =>
      thumbnails.warm(keys.filter(k => /^[0-9a-f]{32}$/.test(k))),
    onReady: ms => console.info(`[library] 引擎就绪（${ms} ms）`),
    onBlocked: reason => console.error(`[library] ${reason}`),
  })
  ipcMain.handle(
    LIBRARY_CHANNELS.invoke,
    (_event, method: unknown, params: unknown) => host.invoke(method, params)
  )
  // 已挂过 destroyed 钩子的窗口：窗口关闭时移出名单，同一窗口刷新后再订阅不重复挂
  const watched = new Set<number>()
  ipcMain.on(LIBRARY_CHANNELS.subscribe, ({ sender }) => {
    const key = sender.id
    if (!watched.has(key)) {
      watched.add(key)
      sender.once('destroyed', () => {
        watched.delete(key)
        host.unsubscribe(key)
      })
    }
    host.subscribe(key, {
      deliver(port) {
        if (sender.isDestroyed()) return
        sender.postMessage(LIBRARY_CHANNELS.port, null, [
          port as Electron.MessagePortMain,
        ])
      },
    })
  })
  ipcMain.on(LIBRARY_CHANNELS.unsubscribe, ({ sender }) =>
    host.unsubscribe(sender.id)
  )
  app.on('will-quit', () => void host.shutdown())
  return {
    async call(method, params) {
      const response = await host.invoke(method, params)
      if (!response.ok) throw new Error(response.error.message)
      return response.result as never
    },
  }
}
