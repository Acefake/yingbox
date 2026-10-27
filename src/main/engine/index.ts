/**
 * 启动引擎宿主并把引擎实现的域注册到 IPC。引擎按需启动：第一次调用时才 fork；
 * 队列里有上次没下完的任务时启动即唤醒，续传不等用户打开下载页。
 */
import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { broadcastChannel, implement } from '../rpc'
import { browserFetch, resetBrowserFetch } from '../browser-fetch'
import { resolveDownloadDir } from '../download-dir'
import { settingsStore } from '../settings'
import { TMDB_SECRET, effectiveTmdbToken } from '../tmdb'
import { av } from '../../shared/contract/av'
import { channelOf } from '../../shared/contract/define'
import { download } from '../../shared/contract/download'
import { online } from '../../shared/contract/online'
import { forwardTo } from './forward'
import { type EngineChild, EngineHost } from './host'
import { resumePendingDownloads } from './pending-downloads'

/** 注册引擎域（online、av、download）。 */
export function registerEngine(): EngineHost {
  const host = new EngineHost({
    fork: () =>
      utilityProcess.fork(
        join(__dirname, 'engine.js'),
        [app.getPath('userData')],
        {
          serviceName: 'yingbox-engine',
          // stderr 先过崩溃守卫（认出缺依赖），再原样转到终端
          stdio: ['ignore', 'inherit', 'pipe'],
        }
      ) as unknown as EngineChild,
    broadcast: broadcastChannel,
    onReady: ms => console.info(`[engine] 引擎就绪（${ms} ms）`),
    onBlocked: reason => console.error(`[engine] ${reason}`),
    hostMethods: {
      browserFetch: url => browserFetch(url),
      resetBrowserFetch: async host => resetBrowserFetch(host),
      downloadDir: async () =>
        resolveDownloadDir(
          settingsStore().get('download.dir'),
          app.getPath('videos')
        ),
      tmdbToken: async () =>
        effectiveTmdbToken(settingsStore().getSecret(TMDB_SECRET)),
      tmdbLanguage: async () => settingsStore().get('scrape.metadataLanguage'),
    },
  })
  implement(online, forwardTo(host, online))
  implement(av, forwardTo(host, av))
  implement(download, forwardTo(host, download))
  app.on('will-quit', () => void host.shutdown())
  void resumePendingDownloads(
    join(app.getPath('userData'), 'downloads', 'queue.json'),
    () => host.invoke(channelOf(download.name, 'list'), [])
  )
  return host
}
