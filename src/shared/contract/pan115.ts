import { call, defineDomain, str } from './define'

/** PanSou 公共实例（第三方维护）；只在用户于设置里点「使用公共实例」时填入，搜索词会发给它 */
export const PANSOU_PUBLIC_URL = 'https://so.252035.xyz'

/** 网盘搜索的一条 115 结果（来自 PanSou） */
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

/**
 * 网盘：PanSou 聚合搜索 + 115 扫码登录、分享预览与转存。
 * 请求都在主进程（带 115 Cookie）；Cookie 只在主进程，渲染层只拿到账号名。
 */
export const pan115 = defineDomain('pan115', {
  /** 用设置里的 PanSou 地址搜 115 分享 */
  search: call<[keyword: string], Pan115Result<{ items: NetdiskItem[] }>>(a => [
    str(a[0], 'keyword'),
  ]),
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
