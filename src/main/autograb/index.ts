/**
 * 追更模块入口：把追更服务接到媒体库（日历、变更通知）、115 服务、设置与 autograb 域。
 * 只依赖模块宿主（module-host），桌面端主进程与独立服务共用。
 *
 * 状态存 <dataDir>/autograb.json（原子替换）。启动 90 秒后跑第一轮，之后每 30 分钟一轮；
 * 一轮里真正向 115 发请求的只有到点的集（见 schedule-rules.ts），平时一轮只查一次本地日历。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  type TrackOnlineResult,
  autograb,
} from '../../shared/contract/autograb'
import {
  defaultFolder,
  readTargetSettings,
} from '../../shared/netdisk/target-folder'
import { atomicWrite } from '../file-operations'
import type { LibraryEngineClient } from '../library/client'
import type { ModuleHost } from '../module-host'
import type { Pan115Service } from '../pan115/service'
import { type ShareRef, parseShareLink } from '../pan115/share-link'
import { Pan115Error } from '../pan115/errors'
import { seriesFolderName } from './folder-name'
import { createPanFolders } from './pan-folders'
import { type AutograbService, createAutograbService } from './service'
import type { EpisodeRecord } from './state'

const FIRST_DELAY_MS = 90_000
const INTERVAL_MS = 30 * 60_000

/**
 * 注册追更（媒体库与 pan115 就绪之后调用一次）。
 * @param host 模块宿主（契约登记、设置、数据目录、定时器）
 * @param hooks.landed 转存过的集入库了（推送通知）
 * @returns 追更服务（gate() 是共用闸门的取法，洗版、电影追踪注册时传进去；isSaved 给推送用）
 */
export function registerAutograb(
  host: ModuleHost,
  library: LibraryEngineClient,
  pan115: Pan115Service,
  hooks: { landed?(records: EpisodeRecord[]): void } = {}
): AutograbService {
  const file = join(host.dataDir, 'autograb.json')
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

  const mountRoot = (): string => host.setting('library.notify.mountRoot')
  const folders = createPanFolders(pan115, mountRoot)

  const service = createAutograbService({
    calendar: range => library.call('calendar.episodes', range),
    seriesFolder: itemId => library.call('calendar.seriesFolder', { itemId }),
    seriesFolderName: async (itemId, title) => {
      const [item, writer] = await Promise.all([
        library.call('getItem', { itemId }).catch(() => null),
        library.call('writer.getSettings', undefined),
      ])
      return seriesFolderName(writer.organize.tvTemplate, item, title)
    },
    seriesExists: async (itemId, title) => {
      const item = await library.call('getItem', { itemId })
      return item !== null && item.type === 'series' && item.title === title
    },
    notify: async changes => {
      const root = mountRoot()
      await library.call(
        'notifyChanges',
        root ? { changes, mountRoot: root } : { changes }
      )
    },
    pan: {
      loggedIn: () => loggedIn,
      pansouReady: () => Boolean(host.setting('pan115.pansouUrl').trim()),
      search: keyword => pan115.searchRaw(keyword),
      snap: (url, password, dirCid, offset) =>
        pan115.use(client =>
          client.snapDir(shareOf(url, password), dirCid, offset)
        ),
      receive: (url, password, ids, cid) =>
        pan115.use(client =>
          client.receiveFiles(shareOf(url, password), ids, cid)
        ),
      entries: cid => pan115.use(client => client.entries(cid)),
      space: () => pan115.use(client => client.space()),
      remove: (cid, fileId) =>
        pan115.use(client => client.deleteFile(cid, fileId)),
      dirPath: cid =>
        pan115.use(async client => {
          const listing = await client.dirs(cid)
          return listing.path.filter(d => d.cid !== '0').map(d => d.name)
        }),
      ...folders,
    },
    defaultFolder: () =>
      defaultFolder(
        'tv',
        readTargetSettings(key => host.setting(key))
      ),
    load: async () => {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
      } catch {
        return null
      }
    },
    save: state => atomicWrite(file, JSON.stringify(state)),
    now: () => Date.now(),
    intervalMs: INTERVAL_MS,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    emit: () => host.emit(autograb, 'changed', undefined),
    log: message => console.info(`[autograb] ${message}`),
    landed: records => hooks.landed?.(records),
  })

  const run = (): void => void refreshAccount().then(() => service.tick())
  host.schedule({
    name: 'autograb',
    firstDelayMs: FIRST_DELAY_MS,
    intervalMs: INTERVAL_MS,
    run,
  })

  host.implement(autograb, {
    overview: async () => {
      await refreshAccount()
      return service.overview()
    },
    setEnabled: (_, enabled) => service.setEnabled(enabled),
    setSeries: (_, seriesId, patch) => service.setSeries(seriesId, patch),
    trackOnline: async (_, request): Promise<TrackOnlineResult> => {
      const found = await library.call('calendar.ensureSeries', request)
      if (found.status === 'ready')
        return { status: 'ready', seriesId: found.itemId }
      if (found.status === 'none') return found
      return {
        status: 'choose',
        candidates: found.candidates.map(c => ({
          id: c.id,
          title: c.title,
          originalTitle: c.originalTitle,
          year: c.year,
          poster: c.poster,
        })),
      }
    },
    setPrefs: (_, prefs) => service.setPrefs(prefs),
    setCategoryFolder: (_, category, cid, name) =>
      service.setCategoryFolder(category, cid, name),
    policy: () => service.policy(),
    setPolicy: (_, patch) => service.setPolicy(patch),
    grab: (_, key, index) => service.grab(key, index),
    revert: (_, key) => service.revert(key),
    skip: (_, key) => service.skip(key),
    retry: (_, key) => service.retry(key),
    runNow: async () => run(),
    resume: async () => {
      await service.resume()
      run()
    },
  })
  return service
}
