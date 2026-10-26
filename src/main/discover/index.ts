/**
 * 库外发现模块入口（只依赖模块宿主，桌面端主进程与独立服务共用）：把库外发现服务接到 115 服务、追更的闸门、设置、媒体库变更通知与 discover 域。
 *
 * 转存目标：设置 `pan115.movieCid`（助手转存目标文件夹）；没设时跟随网盘设置里的转存目标 `pan115.targetCid`；
 * 两处都为空时是根目录（cid 0）。
 */
import { discover } from '../../shared/contract/discover'
import type { AutograbService } from '../autograb/service'
import type { LibraryEngineClient } from '../library/client'
import type { ModuleHost } from '../module-host'
import { Pan115Error } from '../pan115/errors'
import type { Pan115Service } from '../pan115/service'
import { type ShareRef, parseShareLink } from '../pan115/share-link'
import { createDiscoverService } from './service'

/** 注册库外发现（registerAutograb 之后调用一次） */
export function registerDiscover(
  host: ModuleHost,
  library: LibraryEngineClient,
  pan115: Pan115Service,
  autograb: AutograbService
): void {
  const shareOf = (url: string, password: string): ShareRef => {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }

  const service = createDiscoverService({
    pan: {
      loggedIn: async () => (await pan115.account()).loggedIn,
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
      names: cid =>
        pan115.use(async client =>
          (await client.entries(cid)).map(e => e.name)
        ),
      dirPath: cid =>
        pan115.use(async client => {
          const listing = await client.dirs(cid)
          return listing.path.filter(d => d.cid !== '0').map(d => d.name)
        }),
    },
    guard: () => autograb.guard(),
    folder: () => {
      const movieCid = host.setting('pan115.movieCid')
      if (movieCid)
        return { cid: movieCid, name: host.setting('pan115.movieName') }
      // 两处都没设时明确落到根目录（cid 0），不把空串交给 115
      const cid = host.setting('pan115.targetCid') || '0'
      return { cid, name: cid === '0' ? '' : host.setting('pan115.targetName') }
    },
    notify: async changes => {
      const mountRoot = host.setting('library.notify.mountRoot')
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    now: () => Date.now(),
    later: (run, ms) => void setTimeout(run, ms).unref(),
    log: message => console.info(`[discover] ${message}`),
  })

  host.implement(discover, {
    status: () => service.status(),
    find: (_, target) => service.find(target),
    save: (_, searchId, index) => service.save(searchId, index),
  })
}
