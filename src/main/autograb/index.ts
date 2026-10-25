/**
 * 主进程追更模块入口：把追更服务接到媒体库引擎（日历、变更通知）、115 服务、设置与 autograb 域。
 *
 * 状态存 userData/autograb.json（原子替换）。启动 90 秒后跑第一轮，之后每 30 分钟一轮；
 * 一轮里真正向 115 发请求的只有到点的集（见 schedule-rules.ts），平时一轮只查一次本地日历。
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { autograb } from '../../shared/contract/autograb'
import { atomicWrite } from '../file-operations'
import type { LibraryEngineClient } from '../library/host'
import type { Pan115Service } from '../pan115/service'
import { type ShareRef, parseShareLink } from '../pan115/share-link'
import { Pan115Error } from '../pan115/errors'
import { emit, implement } from '../rpc'
import { settingsStore } from '../settings'
import type { Gate } from './gate'
import { createAutograbService } from './service'

const FIRST_DELAY_MS = 90_000
const INTERVAL_MS = 30 * 60_000

/**
 * 注册追更（registerLibraryIpc 与 registerPan115 之后调用一次）。
 * @returns 共用闸门的取法（洗版、电影追踪注册时传进去）
 */
export function registerAutograb(
  library: LibraryEngineClient,
  pan115: Pan115Service
): () => Promise<Gate> {
  const store = settingsStore()
  const file = join(app.getPath('userData'), 'autograb.json')
  const shareOf = (url: string, password: string): ShareRef => {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }
  let loggedIn = false
  const refreshAccount = (): Promise<void> =>
    pan115
      .account()
      .then(a => void (loggedIn = a.loggedIn))
      .catch(() => {})

  const service = createAutograbService({
    calendar: range => library.call('calendar.episodes', range),
    notify: async changes => {
      const mountRoot = store.get('library.notify.mountRoot')
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    pan: {
      loggedIn: () => loggedIn,
      pansouReady: () => Boolean(store.get('pan115.pansouUrl').trim()),
      search: keyword => pan115.searchRaw(keyword),
      snap: (url, password, dirCid) =>
        pan115.use(client => client.snapDir(shareOf(url, password), dirCid)),
      receive: (url, password, ids, cid) =>
        pan115.use(client =>
          client.receiveFiles(shareOf(url, password), ids, cid)
        ),
      names: cid => pan115.use(client => client.names(cid)),
      dirPath: cid =>
        pan115.use(async client => {
          const listing = await client.dirs(cid)
          return listing.path.filter(d => d.cid !== '0').map(d => d.name)
        }),
    },
    defaultCid: () => store.get('pan115.targetCid'),
    load: async () => {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
      } catch {
        return null
      }
    },
    save: state => atomicWrite(file, JSON.stringify(state)),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    emit: () => emit(autograb, 'changed', undefined),
    log: message => console.info(`[autograb] ${message}`),
  })

  const run = (): void => void refreshAccount().then(() => service.tick())
  setTimeout(() => {
    run()
    setInterval(run, INTERVAL_MS).unref()
  }, FIRST_DELAY_MS).unref()

  implement(autograb, {
    overview: async () => {
      await refreshAccount()
      return service.overview()
    },
    setEnabled: (_, enabled) => service.setEnabled(enabled),
    setSeries: (_, seriesId, patch) => service.setSeries(seriesId, patch),
    grab: (_, key, index) => service.grab(key, index),
    skip: (_, key) => service.skip(key),
    retry: (_, key) => service.retry(key),
    runNow: async () => run(),
    resume: async () => {
      await service.resume()
      run()
    },
  })
  return service.gate
}
