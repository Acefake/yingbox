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
import { atomicWrite } from '../../file-operations'
import { fetchHttp, readLimited } from '../../http-client'
import type { LibraryEngineClient } from '../../library/client'
import type { ModuleHost } from '../../module-host'
import type { Gate } from '../gate'
import type { PanAdapter } from '../upgrade/pan-adapter'
import { createMoviesService } from './service'
import { type TmdbGet, createMovieTmdb } from './tmdb'

const FIRST_DELAY_MS = 3 * 60_000
const INTERVAL_MS = 60 * 60_000
const TMDB_API = 'https://api.themoviedb.org/3'

/**
 * GET TMDB v3：v4 读访问令牌（eyJ 开头）走 Bearer，v3 API Key 放 api_key；错误信息里的令牌打码。
 */
const tmdbGetter =
  (tmdbToken: () => string): TmdbGet =>
  async (path, query) => {
    const token = tmdbToken()
    if (!token) return null
    const bearer = token.startsWith('eyJ')
    const params = new URLSearchParams(query)
    if (!bearer) params.set('api_key', token)
    try {
      const response = await fetchHttp(
        `${TMDB_API}${path}?${params}`,
        { headers: bearer ? { Authorization: `Bearer ${token}` } : {} },
        15_000
      )
      return JSON.parse(
        (await readLimited(response, 2 * 1024 * 1024)).toString('utf8')
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message.split(token).join('***'))
    }
  }

/** 注册电影上线追踪（registerAutograb 之后调用一次） */
export function registerAutograbMovies(
  host: ModuleHost,
  library: LibraryEngineClient,
  pan: PanAdapter,
  gate: () => Promise<Gate>
): void {
  const tmdbToken = (): string => host.tmdbToken()
  const file = join(host.dataDir, 'autograb-movies.json')
  const service = createMoviesService({
    tmdb: createMovieTmdb(tmdbGetter(tmdbToken)),
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
    notify: async path => {
      const mountRoot = host.setting('library.notify.mountRoot')
      const changes = [{ action: 'create' as const, path }]
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    defaultCid: () => host.setting('pan115.targetCid'),
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
    setFolder: (_, cid, cidName) => service.setFolder(cid, cidName),
    grab: (_, tmdbId, index) => service.grab(tmdbId, index),
    retry: (_, tmdbId) => service.retry(tmdbId),
    runNow: async () => run(),
  })
}
