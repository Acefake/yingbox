/**
 * 主进程库外发现模块入口：把库外发现服务接到 115 服务、追更的闸门、设置、媒体库变更通知与 discover 域。
 *
 * 转存目标：设置 `pan115.movieCid`（助手转存目标文件夹）；没设时跟随网盘设置里的转存目标 `pan115.targetCid`。
 */
import { discover } from '../../shared/contract/discover'
import type { AutograbService } from '../autograb/service'
import type { LibraryEngineClient } from '../library/host'
import { Pan115Error } from '../pan115/errors'
import type { Pan115Service } from '../pan115/service'
import { type ShareRef, parseShareLink } from '../pan115/share-link'
import { implement } from '../rpc'
import { settingsStore } from '../settings'
import { createDiscoverService } from './service'

/** 注册库外发现（registerAutograb 之后调用一次） */
export function registerDiscover(
  library: LibraryEngineClient,
  pan115: Pan115Service,
  autograb: AutograbService
): void {
  const store = settingsStore()
  const shareOf = (url: string, password: string): ShareRef => {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }

  const service = createDiscoverService({
    pan: {
      loggedIn: async () => (await pan115.account()).loggedIn,
      pansouReady: () => Boolean(store.get('pan115.pansouUrl').trim()),
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
      const cid = store.get('pan115.movieCid')
      return cid
        ? { cid, name: store.get('pan115.movieName') }
        : {
            cid: store.get('pan115.targetCid'),
            name: store.get('pan115.targetName'),
          }
    },
    notify: async changes => {
      const mountRoot = store.get('library.notify.mountRoot')
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    now: () => Date.now(),
    later: (run, ms) => void setTimeout(run, ms).unref(),
    log: message => console.info(`[discover] ${message}`),
  })

  implement(discover, {
    status: () => service.status(),
    find: (_, target) => service.find(target),
    save: (_, searchId, index) => service.save(searchId, index),
  })
}
