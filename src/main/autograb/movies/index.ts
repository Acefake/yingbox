/**
 * 主进程电影上线追踪入口：把服务接到 TMDB（主进程带令牌直连 v3）、媒体库引擎、115 和 autograbMovies 域。
 *
 * 状态存 userData/autograb-movies.json（原子替换）。启动 3 分钟后跑第一轮，之后每小时一轮；
 * 没在追任何电影时一轮什么都不做，到了发行日的电影一天只搜一次。
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { autograbMovies } from '../../../shared/contract/autograb-upgrade'
import { atomicWrite } from '../../file-operations'
import { fetchHttp, readLimited } from '../../http-client'
import type { LibraryEngineClient } from '../../library/host'
import { emit, implement } from '../../rpc'
import { settingsStore } from '../../settings'
import { TMDB_SECRET, effectiveTmdbToken } from '../../tmdb'
import type { Gate } from '../gate'
import type { PanAdapter } from '../upgrade/pan-adapter'
import { createMoviesService } from './service'
import { type TmdbGet, createMovieTmdb } from './tmdb'

const FIRST_DELAY_MS = 3 * 60_000
const INTERVAL_MS = 60 * 60_000
const TMDB_API = 'https://api.themoviedb.org/3'

const tmdbToken = (): string =>
  effectiveTmdbToken(settingsStore().getSecret(TMDB_SECRET))

/**
 * GET TMDB v3：v4 读访问令牌（eyJ 开头）走 Bearer，v3 API Key 放 api_key；错误信息里的令牌打码。
 */
const tmdbGet: TmdbGet = async (path, query) => {
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
  library: LibraryEngineClient,
  pan: PanAdapter,
  gate: () => Promise<Gate>
): void {
  const store = settingsStore()
  const file = join(app.getPath('userData'), 'autograb-movies.json')
  const service = createMoviesService({
    tmdb: createMovieTmdb(tmdbGet),
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
      const mountRoot = store.get('library.notify.mountRoot')
      const changes = [{ action: 'create' as const, path }]
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
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
    emit: () => emit(autograbMovies, 'changed', undefined),
    log: message => console.info(`[autograb-movies] ${message}`),
  })

  const run = (): void => void pan.refresh().then(() => service.tick())
  setTimeout(() => {
    run()
    setInterval(run, INTERVAL_MS).unref()
  }, FIRST_DELAY_MS).unref()

  implement(autograbMovies, {
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
