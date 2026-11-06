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
import { isRemotePath } from '../../shared/webdav/remote-path'
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
import type { SeriesSetting } from './state'
import { type SeriesInfo, createSeriesCatalog } from './catalog'
import { createTmdbGet } from './tmdb-http'
import { migrateAutograb } from './migration'
import { templateFolder } from '../../shared/library/writer'
import { createLibraryLinks, libraryLandedRecords } from './library-links'

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
  pan115: Pick<Pan115Service, 'account' | 'use' | 'searchRaw'>,
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
  const tasks = new Map<number, SeriesSetting>()
  const links = createLibraryLinks(
    itemId => library.call('getItem', { itemId }),
    tasks
  )
  const catalog = createSeriesCatalog(
    createTmdbGet(
      () => host.tmdbToken(),
      () => host.setting('network.optimization')
    ),
    () => host.setting('scrape.metadataLanguage')
  )

  const service = createAutograbService({
    calendar: async (range, tracked) => {
      for (const [id, setting] of Object.entries(tracked))
        tasks.set(Number(id), setting)
      const result = await catalog.calendar(range, tracked)
      if (!Object.values(tracked).some(s => s.libraryItemId)) return result
      const local = await library
        .call('calendar.episodes', range)
        .catch(() => null)
      const verified = new Map(
        await Promise.all(
          Object.keys(tracked).map(
            async id => [Number(id), await links.verify(Number(id))] as const
          )
        )
      )
      for (const ep of result.episodes) {
        const linked = verified.get(ep.seriesId)
        const found = local?.episodes.find(
          e =>
            e.seriesId === linked &&
            e.tmdbId === ep.tmdbId &&
            e.season === ep.season &&
            e.episode === ep.episode
        )
        if (found)
          Object.assign(ep, {
            fileId: found.fileId,
            filePath: found.filePath,
            itemId: found.itemId,
            libraryId: found.libraryId,
          })
      }
      return result
    },
    seriesEpisodes: async (id, to, setting) => {
      if (!setting) return []
      const rows = await catalog.episodes(id, setting, {
        from: '1900-01-01',
        to,
      })
      if (!setting.libraryItemId) return rows
      if (!(await links.verify(id))) return rows
      const local = await library
        .call('calendar.seriesEpisodes', { itemId: setting.libraryItemId, to })
        .catch(() => [])
      if (!(await links.verify(id))) return rows
      for (const ep of rows) {
        const found = local.find(
          e =>
            e.tmdbId === setting.tmdbId &&
            e.season === ep.season &&
            e.episode === ep.episode
        )
        if (found)
          Object.assign(ep, {
            fileId: found.fileId,
            filePath: found.filePath,
            itemId: found.itemId,
          })
      }
      return rows
    },
    followsLibrary: id => tasks.get(id)?.syncLibrary === true,
    seriesFolder: async id => {
      const itemId = await links.verify(id)
      return itemId
        ? library.call('calendar.seriesFolder', {
            itemId,
            expectedTmdbId: tasks.get(id)?.tmdbId,
          })
        : Promise.resolve(null)
    },
    seriesFolderName: async (itemId, title) => {
      const setting = tasks.get(itemId)
      if (setting?.tmdbId) {
        const writer = setting.libraryItemId
          ? await library
              .call('writer.getSettings', undefined)
              .catch(() => null)
          : null
        return templateFolder(
          writer?.organize.tvTemplate ??
            '{title} ({year})/{title} S{season:02}E{episode:02}',
          {
            title: setting.title,
            series: setting.title,
            originalTitle: setting.originalTitle ?? setting.title,
            year: setting.year,
            tmdbId: setting.tmdbId,
            season: 1,
            episode: 1,
            ext: 'mkv',
          }
        )
      }
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
      const result = await library.call(
        'notifyChanges',
        root ? { changes, mountRoot: root } : { changes }
      )
      if (result.accepted > 0) return result
      // 没有本地库覆盖这个路径：115 片库（yingbox-dav://pan115/…）靠增量扫描接住新文件
      const remote = (await library.call('listLibraries', undefined)).filter(
        lib => isRemotePath(lib.root)
      )
      await Promise.all(
        remote.map(lib =>
          library.call('scan', { libraryId: lib.id, full: false })
        )
      )
      return { accepted: remote.length }
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
      const raw: unknown = await fs
        .readFile(file, 'utf8')
        .then(s => JSON.parse(s))
        .catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return null
          throw e
        })
      const state = await migrateAutograb(raw, Date.now(), async itemId => {
        const item = await library.call('getItem', { itemId })
        return item
          ? {
              title: item.title,
              tmdbId: item.providerIds.tmdb,
              originalTitle: item.originalTitle ?? '',
              year: item.year,
              poster: item.poster,
            }
          : null
      })
      for (const [id, setting] of Object.entries(state.series))
        tasks.set(Number(id), setting)
      if (
        !raw ||
        (typeof raw === 'object' && 'version' in raw && raw.version !== 2)
      ) {
        if (raw)
          await fs
            .writeFile(`${file}.v1.bak`, JSON.stringify(raw), { flag: 'wx' })
            .catch((e: NodeJS.ErrnoException) => {
              if (e.code !== 'EEXIST') throw e
            })
        await atomicWrite(file, JSON.stringify(state))
      }
      return state
    },
    save: state => atomicWrite(file, JSON.stringify(state)),
    now: () => Date.now(),
    intervalMs: INTERVAL_MS,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    emit: () => host.emit(autograb, 'changed', undefined),
    log: message => console.info(`[autograb] ${message}`),
    landed: records => hooks.landed?.(libraryLandedRecords(records, tasks)),
  })

  const run = (): void => void refreshAccount().then(() => service.tick())
  const track = async (
    info: SeriesInfo,
    libraryItemId?: number
  ): Promise<TrackOnlineResult> => {
    await refreshAccount()
    const id = await service.track(info, libraryItemId)
    tasks.set(id, {
      ...info,
      ...(libraryItemId ? { libraryItemId } : {}),
      title: info.title,
      mode: 'inherit',
      cid: '',
      cidName: '',
      confirmed: 0,
      prefs: {},
    })
    await service.backfill(id)
    return { status: 'ready', seriesId: id }
  }
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
    startSeries: async (_, seriesId) => {
      await refreshAccount()
      return service.startSeries(seriesId)
    },
    setSeries: async (_, seriesId, patch) => {
      const result = await service.setSeries(seriesId, patch)
      if (result.ok && patch.mode === 'off') tasks.delete(seriesId)
      return result
    },
    trackOnline: async (_, request): Promise<TrackOnlineResult> => {
      const found = await catalog.resolve(request)
      return found.status === 'ready' ? track(found.info) : found
    },
    trackLibrary: async (_, itemId) => {
      const item = await library.call('getItem', { itemId })
      if (!item || item.type !== 'series' || !item.providerIds.tmdb)
        throw new Error('请先匹配这部剧的 TMDB 信息')
      return track(await catalog.info(item.providerIds.tmdb), itemId)
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
    rescan: (_, key) => service.rescan(key),
    runNow: async () => run(),
    resume: async () => {
      await service.resume()
      run()
    },
  })
  return service
}
