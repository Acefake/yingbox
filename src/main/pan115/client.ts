/**
 * 115 网页接口（webapi.115.com）：分享快照、接收分享、列文件夹。
 * 每个请求带登录 Cookie、Referer https://115.com/ 与桌面 UA；失败按 errno 转人话（见 errors.ts）。
 */
import type {
  Pan115DirListing,
  ShareFile,
  ShareSnap,
} from '../../shared/contract/pan115'
import { Pan115Error, errnoMessage } from './errors'
import { type FetchLike, USER_AGENT, fetchJson, obj, text } from './http'
import type { ShareRef } from './share-link'

const WEBAPI = 'https://webapi.115.com'
/** 快照每页条数 */
const SNAP_PAGE = 100
/** 转存时最多翻几页快照（顶层条目上限 = 页数 × 每页条数） */
const SNAP_MAX_PAGES = 20

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
  /** 列文件夹 cid 下的子文件夹 */
  dirs(cid: string): Promise<Pan115DirListing>
}

/** 用一个会话创建客户端 */
export function create115Client(
  fetch: FetchLike,
  session: Pan115Session
): Pan115Client {
  const headers = {
    Cookie: session.cookie,
    Referer: 'https://115.com/',
    'User-Agent': USER_AGENT,
  }
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
    const json = obj(
      await fetchJson(fetch, '115', `${WEBAPI}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
      })
    )
    if (json.state === true || json.state === 1) return json
    const errno = Number(json.errno ?? json.errNo ?? json.code) || 0
    const original = text(json.error) || text(json.msg)
    const safe = secrets.some(s => original.includes(s)) ? '' : original
    throw new Pan115Error(errnoMessage(errno, safe), errno)
  }

  async function snap(ref: ShareRef, offset = 0): Promise<ShareSnap> {
    const query = new URLSearchParams({
      share_code: ref.shareCode,
      receive_code: ref.receiveCode,
      offset: String(offset),
      limit: String(SNAP_PAGE),
      cid: '',
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
    return {
      title: text(obj(data.shareinfo).share_title),
      count: Number(data.count) || files.length,
      files,
    }
  }

  async function receive(ref: ShareRef, cid: string): Promise<void> {
    const ids: string[] = []
    for (let page = 0; page < SNAP_MAX_PAGES; page++) {
      const { files, count } = await snap(ref, ids.length)
      ids.push(...files.map(f => f.id))
      if (!files.length || ids.length >= count) break
    }
    if (!ids.length) throw new Pan115Error('分享里没有文件')
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

  async function dirs(cid: string): Promise<Pan115DirListing> {
    const query = new URLSearchParams({
      aid: '1',
      cid,
      show_dir: '1',
      nf: '1',
      offset: '0',
      limit: '200',
      format: 'json',
    })
    const json = await request(`/files?${query}`)
    const toDir = (raw: unknown): { cid: string; name: string } => {
      const item = obj(raw)
      return { cid: text(item.cid), name: text(item.name ?? item.n) }
    }
    return {
      cid,
      path: (Array.isArray(json.path) ? json.path : []).map(toDir),
      dirs: (Array.isArray(json.data) ? json.data : [])
        .filter(raw => !text(obj(raw).fid))
        .map(toDir),
    }
  }

  return { snap, receive, dirs }
}
