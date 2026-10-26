import { ContractError, call, defineDomain, str } from './define'

/** PanSou 公共实例（第三方维护）；只在用户于设置里点「使用公共实例」时填入，搜索词会发给它 */
export const PANSOU_PUBLIC_URL = 'https://so.252035.xyz'

/** 网盘搜索的一条 115 分享（来自 PanSou） */
export interface NetdiskItem {
  /** 资源说明 / 标题 */
  title: string
  /** 来源：tg:频道名 / plugin:插件名 */
  source: string
  /** 发布时间（ISO 字符串）；来源没给时缺省 */
  datetime?: string
  /** 原始分享链接 */
  url: string
  shareCode: string
  /** 提取码；没有时为空串 */
  receiveCode: string
}

/** 磁力结果从哪来 */
export type MagnetOrigin = 'pansou' | 'torznab'

/** 一条磁力 / 电驴结果（PanSou 或 Torznab），可交给 115 离线下载 */
export interface MagnetItem {
  title: string
  origin: MagnetOrigin
  /** 来源细节：PanSou 的 tg:频道 / plugin:插件，Torznab 的索引器名 */
  source: string
  kind: 'magnet' | 'ed2k'
  /** magnet:?… 或 ed2k://… */
  link: string
  /** 去重键：btih 小写十六进制或 ed2k 哈希 */
  hash: string
  /** 发布时间（ISO 字符串）；来源没给时缺省 */
  datetime?: string
  /** 字节数；来源没给时缺省 */
  size?: number
  /** 做种数（只有 Torznab 给） */
  seeders?: number
  /** 下载中的人数（只有 Torznab 给） */
  peers?: number
}

/** 一次搜索的结果：115 分享 + 磁力；notes 是没拿到结果的来源（一个来源失败不拖垮整次搜索） */
export interface NetdiskSearchResult {
  items: NetdiskItem[]
  magnets: MagnetItem[]
  notes: string[]
}

/** Torznab 配置（API Key 只在主进程 / 服务端，渲染层只知道填没填） */
export interface TorznabConfig {
  /** 一行一个 Torznab 接口地址 */
  urls: string[]
  hasKey: boolean
}

/** 设置 · 网盘最多填几个 Torznab 地址 */
export const MAX_TORZNAB_URLS = 8

/** 115 账号（不含 Cookie） */
export type Pan115Account =
  | { loggedIn: false }
  | { loggedIn: true; userId: string; userName: string }

/** 分享里的一个顶层条目 */
export interface ShareFile {
  id: string
  name: string
  /** 字节数；文件夹为 0 */
  size: number
  isDir: boolean
}

/** 分享快照 */
export interface ShareSnap {
  title: string
  /** 顶层条目总数 */
  count: number
  files: ShareFile[]
}

/** 115 里的一个文件夹 */
export interface Pan115Dir {
  cid: string
  name: string
}

/** 一层目录：面包屑 + 子文件夹 */
export interface Pan115DirListing {
  cid: string
  path: Pan115Dir[]
  dirs: Pan115Dir[]
  /** 子文件夹太多、只取了前一部分 */
  truncated: boolean
}

/** 扫码登录的轮询结果 */
export type Pan115LoginPoll =
  | { status: 'waiting' }
  | { status: 'scanned' }
  | { status: 'expired' }
  | { status: 'canceled' }
  | { status: 'done'; account: Pan115Account }
  | { status: 'error'; error: string }

/** 成功带数据、失败带人话的结果 */
export type Pan115Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

const nullableStr = (value: unknown, name: string): string | null =>
  value === null ? null : str(value, name).slice(0, 500)

const torznabUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new ContractError('参数 urls 应为数组')
  if (value.length > MAX_TORZNAB_URLS)
    throw new ContractError(`Torznab 地址最多 ${MAX_TORZNAB_URLS} 个`)
  return value.map(url => str(url, 'urls').trim().slice(0, 2048))
}

/**
 * 网盘：PanSou / Torznab 搜索（115 分享与磁力）+ 115 扫码登录、分享预览与转存。
 * 请求都在主进程（带 115 Cookie）；Cookie 只在主进程，渲染层只拿到账号名。
 */
export const pan115 = defineDomain('pan115', {
  /** 用设置里的 PanSou / Torznab 搜 115 分享与磁力 */
  search: call<[keyword: string], Pan115Result<NetdiskSearchResult>>(a => [
    str(a[0], 'keyword'),
  ]),
  /** Torznab 配置（不含 API Key） */
  torznab: call<TorznabConfig>(),
  /** 保存 Torznab 地址；apiKey 为 null 时保留原来的 Key，空串清除 */
  setTorznab: call<[urls: string[], apiKey: string | null], Pan115Result>(a => [
    torznabUrls(a[0]),
    nullableStr(a[1], 'apiKey'),
  ]),
  /** 测试连接（用传入的地址；apiKey 为 null 时用已保存的）：返回每个地址的结果 */
  testTorznab: call<
    [urls: string[], apiKey: string | null],
    Pan115Result<{ lines: string[] }>
  >(a => [torznabUrls(a[0]), nullableStr(a[1], 'apiKey')]),
  /** 当前登录的 115 账号 */
  account: call<Pan115Account>(),
  /** 取一张新的登录二维码（图片地址） */
  loginStart: call<Pan115Result<{ imageUrl: string }>>(),
  /** 查一次二维码状态；确认后主进程保存登录 */
  loginPoll: call<Pan115LoginPoll>(),
  /** 退出：删掉保存的登录 */
  logout: call<void>(),
  /** 预览分享里的文件 */
  snap: call<[url: string, password: string], Pan115Result<ShareSnap>>(a => [
    str(a[0], 'url'),
    str(a[1], 'password'),
  ]),
  /** 把整个分享转存到设置里的目标文件夹 */
  receive: call<[url: string, password: string], Pan115Result>(a => [
    str(a[0], 'url'),
    str(a[1], 'password'),
  ]),
  /** 列一层文件夹（选目标文件夹用；cid 0 为根目录） */
  dirs: call<[cid: string], Pan115Result<Pan115DirListing>>(a => [
    str(a[0], 'cid'),
  ]),
})
