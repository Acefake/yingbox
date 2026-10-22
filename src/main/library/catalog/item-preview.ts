/**
 * 海报墙悬停预览的数据（RPC getPreview，契约见 contract-library.ts 的 ItemPreview）。
 *
 * - 本机可靠磁盘：给第一个视频文件（电影按路径排序；剧集取第一季第一集，特别篇排最后），
 *   渲染层经 local:// 协议（Range 流）从片中 10% 处播几秒；
 * - 网盘 / 网络路径：根目录是 UNC（\\server\share、//server/share），或 fs-type 判定为事件不可靠的
 *   文件系统（nfs / cifs / fuse …，与目录监控同一判定，见 scanner/fs-type.ts）——不拉视频，
 *   只给已缓存的图片轮播（读网盘上的视频要整段走网络，CloudDrive 等挂载会真的去下载）。
 *
 * 判定按根目录缓存（库存在期间根目录所在的文件系统不会变）。
 */
import type {
  ItemPreview,
  LibraryItemFile,
  LibraryItemNode,
} from '../../../shared/library/ipc'
import { detectUnreliableFs } from '../scanner/fs-type'

/** 最多给几张图 */
const MAX_IMAGES = 8
/** 只算已缓存到本地的图（远程地址在网盘场景里同样要走网络） */
const CACHED_IMAGE = /^yingbox-media:\/\/image\/[0-9a-f]{32}/

/** UNC 路径（Windows 网络共享）。 */
export function isNetworkPath(path: string): boolean {
  return /^(?:\\\\|\/\/)[^\\/]/.test(path)
}

const byPath = (a: LibraryItemFile, b: LibraryItemFile): number =>
  a.path.localeCompare(b.path, undefined, { numeric: true })

/** 季 / 集排序：第 1 季起按序，特别篇（第 0 季）与没编号的排最后。 */
const order = (n: number | null): number => (n && n > 0 ? n : Infinity)

/** 节点（及其子节点）里第一个视频文件。 */
function firstVideo(node: LibraryItemNode): LibraryItemFile | null {
  const own = node.files.filter(file => file.kind === 'video').sort(byPath)
  if (own.length) return own[0]
  const children = [...node.children].sort(
    (a, b) =>
      order(a.seasonNumber) - order(b.seasonNumber) ||
      order(a.episodeNumber) - order(b.episodeNumber)
  )
  for (const child of children) {
    const found = firstVideo(child)
    if (found) return found
  }
  return null
}

/** 背景图在前，再按树的顺序收季 / 集的图；去重、去掉海报、只要已缓存的。 */
function cachedImages(node: LibraryItemNode): string[] {
  const out: string[] = []
  const visit = (n: LibraryItemNode): void => {
    for (const url of [n.backdrop, n === node ? null : n.poster]) {
      if (out.length >= MAX_IMAGES) return
      if (
        url &&
        CACHED_IMAGE.test(url) &&
        url !== node.poster &&
        !out.includes(url)
      )
        out.push(url)
    }
    for (const child of n.children) visit(child)
  }
  visit(node)
  return out
}

/** 由条目详情树得到预览数据；network 为真时不给视频。 */
export function buildItemPreview(
  node: LibraryItemNode,
  network: boolean
): ItemPreview {
  const file = network ? null : firstVideo(node)
  return {
    video: file ? { fileId: file.id, path: file.path } : null,
    images: cachedImages(node),
  }
}

/** 预览查询的依赖。 */
export interface ItemPreviewDeps {
  getItem: (itemId: number) => LibraryItemNode | null
  /** 媒体库根目录；库已删除返回 undefined */
  libraryRoot: (libraryId: number) => string | undefined
  /** fs-type 判定（测试注入）；缺省 detectUnreliableFs */
  detectFs?: (root: string) => Promise<string | undefined>
}

/** 创建预览查询。 */
export function createItemPreviews(deps: ItemPreviewDeps): {
  get(itemId: number): Promise<ItemPreview | null>
} {
  const detect = deps.detectFs ?? (root => detectUnreliableFs(root))
  const network = new Map<string, Promise<boolean>>()
  const isNetwork = (root: string): Promise<boolean> => {
    let found = network.get(root)
    if (!found) {
      found = isNetworkPath(root)
        ? Promise.resolve(true)
        : detect(root).then(Boolean, () => false)
      network.set(root, found)
    }
    return found
  }
  return {
    async get(itemId) {
      const node = deps.getItem(itemId)
      if (!node) return null
      const root = deps.libraryRoot(node.libraryId)
      return buildItemPreview(
        node,
        root === undefined || (await isNetwork(root))
      )
    },
  }
}
