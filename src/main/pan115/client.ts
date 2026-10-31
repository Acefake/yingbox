/**
 * 115 网页接口（webapi.115.com）：分享快照、接收分享、列文件夹、剩余空间、删除文件。
 * 登录 Cookie、Referer 与 UA 由传输层（独立分区，见 transport.ts）带上，这里不写这几个头；
 * 失败按 errno 转人话（见 errors.ts）。
 */
import type { OfflineAddItem } from '../../shared/contract/offline'
import type {
  Pan115DirListing,
  ShareFile,
  ShareSnap,
} from '../../shared/contract/pan115'
import { Pan115Error, errnoMessage } from './errors'
import { type FetchLike, fetchJson, obj, text } from './http'
import {
  type OfflineTaskPage,
  addOfflineUrls,
  listOfflineTasks,
} from './offline'
import type { ShareRef } from './share-link'

const WEBAPI = 'https://webapi.115.com'
/** 快照每页条数 */
const SNAP_PAGE = 100
/** 转存时最多翻几页快照（顶层条目上限 = 页数 × 每页条数） */
const SNAP_MAX_PAGES = 20
/** 一次转存的顶层条目上限 */
const RECEIVE_MAX = SNAP_PAGE * SNAP_MAX_PAGES
/** 文件夹列表每页条数与最多页数 */
const DIR_PAGE = 200
const DIR_MAX_PAGES = 5

/** 自己网盘里的一个条目（追更查重、记下转存出的文件、撤销前核对用） */
export interface DriveEntry {
  /** 文件是 fid，文件夹是 cid */
  id: string
  name: string
  size: number
  isDir: boolean
  pickCode?: string
}

/** 网盘空间（字节） */
export interface DriveSpace {
  total: number
  remain: number
}

/** 已登录的 115 会话（Cookie 只在主进程） */
export interface Pan115Session {
  /** "UID=…; CID=…; SEID=…; KID=…" */
  cookie: string
  userId: string
  userName: string
}

/** 115 客户端 */
export interface Pan115Client {
  /** 分享的一页顶层条目 */
  snap(ref: ShareRef, offset?: number): Promise<ShareSnap>
  /** 把分享的全部顶层条目存到文件夹 cid */
  receive(ref: ShareRef, cid: string): Promise<void>
  /** 分享里某个文件夹（dirCid，空串 = 顶层）从 offset 起的一页条目（追更挑文件用） */
  snapDir(ref: ShareRef, dirCid: string, offset?: number): Promise<ShareSnap>
  /** 只把分享里的这些文件存到文件夹 cid（追更只存那一集） */
  receiveFiles(ref: ShareRef, fileIds: string[], cid: string): Promise<void>
  /** 列文件夹 cid 下的子文件夹 */
  dirs(cid: string): Promise<Pan115DirListing>
  /** 文件夹 cid 下第一页条目（文件和文件夹，新上传的在前；追更查重、找转存出的文件用） */
  entries(cid: string, offset?: number): Promise<DriveEntry[]>
  /** 获取文件的临时播放地址，凭据仅在服务端使用。 */
  downloadUrl(pickCode: string): Promise<string>
  /** 网盘总空间与剩余空间 */
  space(): Promise<DriveSpace>
  /** 删除文件夹 cid 里的一个文件（进回收站）；只接受一个数字 id */
  deleteFile(cid: string, fileId: string): Promise<void>
  /** 把磁力 / 电驴链接加进云下载，存到文件夹 cid（见 offline.ts） */
  addOffline(links: readonly string[], cid: string): Promise<OfflineAddItem[]>
  /** 云下载任务列表的一页（新加的在前） */
  offlineTasks(page?: number): Promise<OfflineTaskPage>
}

/** 用一个会话创建客户端 */
export function create115Client(
  fetch: FetchLike,
  session: Pan115Session
): Pan115Client {
  // 115 的错误原文里若带了 Cookie 的值，宁可不用原文
  const secrets = session.cookie
    .split(/;\s*/)
    .map(pair => pair.slice(pair.indexOf('=') + 1))
    .filter(value => value.length >= 4)

  /** 请求并检查 state；失败抛 {@link Pan115Error} */
  async function request(
    path: string,
    init: RequestInit = {}
  ): Promise<Record<string, unknown>> {
    const json = obj(await fetchJson(fetch, '115', `${WEBAPI}${path}`, init))
    if (json.state === true || json.state === 1) return json
    const errno = Number(json.errno ?? json.errNo ?? json.code) || 0
    const original = text(json.error) || text(json.msg)
    const safe = secrets.some(s => original.includes(s)) ? '' : original
    throw new Pan115Error(errnoMessage(errno, safe), errno)
  }

  /** 一页快照；total 为 115 给的总数（没给时 null），rawLength 为本页原始条数（推进 offset 用） */
  async function snapPage(
    ref: ShareRef,
    offset: number,
    dirCid = ''
  ): Promise<{
    title: string
    files: ShareFile[]
    total: number | null
    rawLength: number
  }> {
    const query = new URLSearchParams({
      share_code: ref.shareCode,
      receive_code: ref.receiveCode,
      offset: String(offset),
      limit: String(SNAP_PAGE),
      cid: dirCid,
    })
    const data = obj((await request(`/share/snap?${query}`)).data)
    const list = Array.isArray(data.list) ? data.list : []
    const files = list.map((raw): ShareFile => {
      const item = obj(raw)
      // 文件有 fid（cid 是所在目录）；文件夹没有 fid，cid 是它自己
      const isDir = !text(item.fid)
      return {
        id: text(isDir ? item.cid : item.fid),
        name: text(item.n),
        size: Number(item.s) || 0,
        isDir,
      }
    })
    const total = Number(data.count)
    return {
      title: text(obj(data.shareinfo).share_title),
      files,
      total: data.count !== undefined && Number.isFinite(total) ? total : null,
      rawLength: list.length,
    }
  }

  async function snap(ref: ShareRef, offset = 0): Promise<ShareSnap> {
    const page = await snapPage(ref, offset)
    return {
      title: page.title,
      count: page.total ?? page.files.length,
      files: page.files,
    }
  }

  /**
   * 收齐全部顶层条目再一次接收。终止条件：本页不足一页，或已取到 115 给的总数；
   * 不靠 count 兜底（115 不返回 count 时也翻到最后一页）。超过上限时报错，不静默只存一部分。
   */
  async function receive(ref: ShareRef, cid: string): Promise<void> {
    const tooMany = (): Pan115Error =>
      new Pan115Error(
        `分享超过 ${RECEIVE_MAX} 项，超出一次转存的上限，请在 115 里打开分享转存`
      )
    const ids: string[] = []
    let offset = 0
    for (let page = 0; ; page++) {
      if (page >= SNAP_MAX_PAGES) throw tooMany()
      const { files, total, rawLength } = await snapPage(ref, offset)
      if (total !== null && total > RECEIVE_MAX) throw tooMany()
      ids.push(...files.map(f => f.id).filter(Boolean))
      offset += rawLength
      if (rawLength < SNAP_PAGE || (total !== null && offset >= total)) break
    }
    if (!ids.length) throw new Pan115Error('分享里没有文件')
    await receiveIds(ref, ids, cid)
  }

  async function snapDir(
    ref: ShareRef,
    dirCid: string,
    offset = 0
  ): Promise<ShareSnap> {
    const page = await snapPage(ref, offset, dirCid)
    return {
      title: page.title,
      count: page.total ?? page.files.length,
      files: page.files,
    }
  }

  async function receiveFiles(
    ref: ShareRef,
    fileIds: string[],
    cid: string
  ): Promise<void> {
    const ids = fileIds.filter(id => /^\d+$/.test(id))
    if (!ids.length) throw new Pan115Error('没有要转存的文件')
    await receiveIds(ref, ids, cid)
  }

  async function receiveIds(
    ref: ShareRef,
    ids: string[],
    cid: string
  ): Promise<void> {
    await request('/share/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        share_code: ref.shareCode,
        receive_code: ref.receiveCode,
        file_id: ids.join(','),
        cid,
        user_id: session.userId,
      }).toString(),
    })
  }

  /** 列子文件夹：按 offset 分页取，最多 {@link DIR_MAX_PAGES} 页，还有更多时 truncated */
  async function dirs(cid: string): Promise<Pan115DirListing> {
    const toDir = (raw: unknown): { cid: string; name: string } => {
      const item = obj(raw)
      return { cid: text(item.cid), name: text(item.name ?? item.n) }
    }
    let path: Pan115DirListing['path'] = []
    const found: Pan115DirListing['dirs'] = []
    let offset = 0
    let truncated = false
    for (let page = 0; ; page++) {
      if (page >= DIR_MAX_PAGES) {
        truncated = true
        break
      }
      const query = new URLSearchParams({
        aid: '1',
        cid,
        show_dir: '1',
        nf: '1',
        offset: String(offset),
        limit: String(DIR_PAGE),
        format: 'json',
      })
      const json = await request(`/files?${query}`)
      const data = Array.isArray(json.data) ? json.data : []
      if (page === 0)
        path = (Array.isArray(json.path) ? json.path : []).map(toDir)
      found.push(...data.filter(raw => !text(obj(raw).fid)).map(toDir))
      offset += data.length
      const total = Number(json.count)
      if (data.length < DIR_PAGE || (Number.isFinite(total) && offset >= total))
        break
    }
    return { cid, path, dirs: found, truncated }
  }

  async function entries(cid: string, offset = 0): Promise<DriveEntry[]> {
    const query = new URLSearchParams({
      aid: '1',
      cid,
      show_dir: '1',
      o: 'user_ptime',
      asc: '0',
      offset: String(offset),
      limit: String(DIR_PAGE),
      format: 'json',
    })
    const json = await request(`/files?${query}`)
    const data = Array.isArray(json.data) ? json.data : []
    return data
      .map((raw): DriveEntry => {
        const item = obj(raw)
        const isDir = !text(item.fid)
        return {
          id: text(isDir ? item.cid : item.fid),
          name: text(item.n ?? item.name),
          size: Number(item.s) || 0,
          isDir,
          ...(text(item.pc) ? { pickCode: text(item.pc) } : {}),
        }
      })
      .filter(e => e.name && e.id)
  }

  async function space(): Promise<DriveSpace> {
    const data = obj((await request('/files/index_info')).data)
    const info = obj(data.space_info)
    const size = (key: string): number => Number(obj(info[key]).size)
    const total = size('all_total')
    const remain = size('all_remain')
    if (!Number.isFinite(remain) || !Number.isFinite(total))
      throw new Pan115Error('115 没有返回剩余空间')
    return { total, remain }
  }

  async function deleteFile(cid: string, fileId: string): Promise<void> {
    if (!/^\d+$/.test(fileId) || !/^\d+$/.test(cid))
      throw new Pan115Error('要删除的文件 id 不对')
    await request('/rb/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        pid: cid,
        'fid[0]': fileId,
        ignore_warn: '1',
      }).toString(),
    })
  }

  return {
    snap,
    receive,
    snapDir,
    receiveFiles,
    dirs,
    entries,
    async downloadUrl(pickCode) {
      const data = await request(
        `/files/download?pickcode=${encodeURIComponent(pickCode)}`
      )
      const url = text(data.file_url)
      if (!url) throw new Pan115Error('115 未返回播放地址，请检查账号权限')
      return url
    },
    space,
    deleteFile,
    addOffline: (links, cid) =>
      addOfflineUrls(fetch, session.userId, links, cid),
    offlineTasks: page => listOfflineTasks(fetch, page),
  }
}
