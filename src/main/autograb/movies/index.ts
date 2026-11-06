/**
 * 电影上线追踪入口：把服务接到 TMDB（带令牌直连 v3）、媒体库、115 和 autograbMovies 域。
 * 只依赖模块宿主（module-host），桌面端主进程与独立服务共用。
 *
 * 状态存 <dataDir>/autograb-movies.json（原子替换）。启动 3 分钟后跑第一轮，之后每小时一轮；
 * 没在追任何电影时一轮什么都不做，到了发行日的电影一天只搜一次。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { autograbMovies } from '../../../shared/contract/autograb-upgrade'
import {
  defaultFolder,
  readTargetSettings,
} from '../../../shared/netdisk/target-folder'
import { atomicWrite } from '../../file-operations'
import type { LibraryEngineClient } from '../../library/client'
import type { ModuleHost } from '../../module-host'
import type { Gate } from '../gate'
import type { PanAdapter } from '../upgrade/pan-adapter'
import { movieFolderName } from '../folder-name'
import { type MoviesService, createMoviesService } from './service'
import { createMovieTmdb } from './tmdb'
import { createTmdbGet } from '../tmdb-http'

const FIRST_DELAY_MS = 3 * 60_000
const INTERVAL_MS = 60 * 60_000
/** 注册电影上线追踪（registerAutograb 之后调用一次） */
export function registerAutograbMovies(
  host: ModuleHost,
  library: LibraryEngineClient,
  pan: PanAdapter,
  gate: () => Promise<Gate>
): MoviesService {
  const tmdbToken = (): string => host.tmdbToken()
  const file = join(host.dataDir, 'autograb-movies.json')
  const service = createMoviesService({
    tmdb: createMovieTmdb(
      createTmdbGet(tmdbToken, () => host.setting('network.optimization')),
      () => host.setting('scrape.metadataLanguage')
    ),
    tmdbReady: () => Boolean(tmdbToken()),
    inLibrary: async (tmdbId, title) => {
      const result = await library.call('query', {
        types: ['movie'],
        source: 'tmdb',
        search: title,
        limit: 50,
      })
      return result.items.some(i => i.providerIds.tmdb === String(tmdbId))
    },
    gate,
    pan,
    folderName: async movie =>
      movieFolderName(
        (await library.call('writer.getSettings', undefined)).organize
          .movieTemplate,
        movie
      ),
    notify: async path => {
      const mountRoot = host.setting('library.notify.mountRoot')
      const changes = [{ action: 'create' as const, path }]
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    defaultFolder: () =>
      defaultFolder(
        'movie',
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
    emit: () => host.emit(autograbMovies, 'changed', undefined),
    log: message => console.info(`[autograb-movies] ${message}`),
  })

  const run = (): void => void pan.refresh().then(() => service.tick())
  host.schedule({
    name: 'autograb-movies',
    firstDelayMs: FIRST_DELAY_MS,
    intervalMs: INTERVAL_MS,
    run,
  })

  host.implement(autograbMovies, {
    overview: async () => {
      await pan.refresh()
      return service.overview()
    },
    search: (_, query) => service.search(query),
    status: (_, tmdbId) => service.status(tmdbId),
    track: (_, tmdbId) => service.track(tmdbId),
    untrack: (_, tmdbId) => service.untrack(tmdbId),
    setMode: (_, tmdbId, mode) => service.setMode(tmdbId, mode),
    setPrefs: (_, tmdbId, prefs) => service.setPrefs(tmdbId, prefs),
    policy: () => service.policy(),
    setPolicy: async (_, patch) => {
      const result = await service.setPolicy(patch)
      if (result.ok) run()
      return result
    },
    setFolder: (_, cid, cidName) => service.setFolder(cid, cidName),
    grab: (_, tmdbId, index) => service.grab(tmdbId, index),
    retry: (_, tmdbId) => service.retry(tmdbId),
    runNow: async () => run(),
  })
  return service
}
