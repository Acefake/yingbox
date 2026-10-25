/**
 * 洗版与电影追踪共用的 115 / PanSou 能力：把 Pan115Service 包成两个服务要的形状（和剧集追更 index.ts 同一套）。
 * 登录状态由调用方定时刷新（refresh），读的时候不发请求。
 */
import type {
  NetdiskItem,
  Pan115DirListing,
  ShareSnap,
} from '../../../shared/contract/pan115'
import { Pan115Error } from '../../pan115/errors'
import type { Pan115Service } from '../../pan115/service'
import { type ShareRef, parseShareLink } from '../../pan115/share-link'
import { settingsStore } from '../../settings'

/** 两个服务要的 115 能力（并集） */
export interface PanAdapter {
  loggedIn(): boolean
  pansouReady(): boolean
  search(keyword: string): Promise<NetdiskItem[]>
  snap(url: string, password: string, dirCid: string): Promise<ShareSnap>
  receive(
    url: string,
    password: string,
    fileIds: string[],
    cid: string
  ): Promise<void>
  names(cid: string): Promise<string[]>
  dirs(cid: string): Promise<Pan115DirListing>
  dirPath(cid: string): Promise<string[]>
  /** 刷新登录状态 */
  refresh(): Promise<void>
}

/** 包装 Pan115Service */
export function createPanAdapter(pan115: Pan115Service): PanAdapter {
  const store = settingsStore()
  let loggedIn = false
  const shareOf = (url: string, password: string): ShareRef => {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }
  return {
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
    dirs: cid => pan115.use(client => client.dirs(cid)),
    dirPath: cid =>
      pan115.use(async client => {
        const listing = await client.dirs(cid)
        return listing.path.filter(d => d.cid !== '0').map(d => d.name)
      }),
    refresh: () =>
      pan115
        .account()
        .then(a => void (loggedIn = a.loggedIn))
        .catch(() => {}),
  }
}
