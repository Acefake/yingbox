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

/**
 * 包装 Pan115Service。
 * @param pansouUrl 设置里的 PanSou 地址（空串 = 未填）
 */
export function createPanAdapter(
  pan115: Pan115Service,
  pansouUrl: () => string
): PanAdapter {
  let loggedIn = false
  const shareOf = (url: string, password: string): ShareRef => {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }
  return {
    loggedIn: () => loggedIn,
    pansouReady: () => Boolean(pansouUrl().trim()),
    search: keyword => pan115.searchRaw(keyword),
    snap: (url, password, dirCid) =>
      pan115.use(client => client.snapDir(shareOf(url, password), dirCid)),
    receive: (url, password, ids, cid) =>
      pan115.use(client =>
        client.receiveFiles(shareOf(url, password), ids, cid)
      ),
    // 115 客户端只给条目列表（#155 去掉了 names），这里取名字
    names: cid =>
      pan115.use(async client => (await client.entries(cid)).map(e => e.name)),
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
