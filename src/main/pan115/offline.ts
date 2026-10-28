/**
 * 115 云下载（离线下载）接口，用现有登录会话（Cookie 由传输层带上）：
 *
 * - 添加任务：POST https://clouddownload.115.com/lixianssp/?ac=add_task_urls，表单 data = m115 编码的
 *   { ac, app_ver, uid, url[0..n], wp_path_id }，响应 data 同样 m115 编码，逐条给结果（errcode 10008 = 任务已存在，
 *   当成功）；这是 115 客户端用的接口（网页端旧的 115.com/web/lixian 已提示「请升级新版本的 115 客户端」），
 *   请求带 115 客户端的 UA；
 * - 任务列表：GET https://clouddownload.115.com/web/?ac=task_lists&page=…（明文 JSON）；
 * 两个都先试 clouddownload.115.com，404 / 不是 JSON 时退回旧域名 lixian.115.com。
 * 状态码：-1 失败、0 等待、1 下载中、2 完成。真实接口未在沙箱里验证。
 */
import {
  MAX_OFFLINE_LINKS,
  type OfflineAddItem,
  type OfflineStatus,
} from '../../shared/contract/offline'
import { Pan115Error, errnoMessage } from './errors'
import { type FetchLike, fetchJson, obj, text } from './http'
import { type M115Key, M115_PUBLIC, m115Decode, m115Encode } from './m115'

/** 115 客户端版本号（lixianssp 要带；取自公开实现，过旧时 115 会提示升级） */
export const CLIENT_VERSION = '36.2.28'
/** 115 客户端 UA（传输层看到 115Browser 时保留，不换成桌面 Chrome UA） */
export const CLIENT_USER_AGENT = `Mozilla/5.0 115disk/${CLIENT_VERSION} 115Browser/${CLIENT_VERSION} 115wangpan_android/${CLIENT_VERSION}`

const HOSTS = ['https://clouddownload.115.com', 'https://lixian.115.com']
const TASK_PAGE_SIZE = 30

/** 任务已存在 */
const TASK_EXISTS = 10008
const ADD_MESSAGES: Record<number, string> = {
  10004: '链接不合法或 115 不支持',
  10008: '任务已在离线列表里',
}

/** 列表里的一个任务（115 原始字段整理后） */
export interface RawOfflineTask {
  hash: string
  name: string
  size: number
  percent: number
  status: OfflineStatus
  addedAt: number
  folderCid: string
  fileId: string
  error?: string
}

/** 一页任务 */
export interface OfflineTaskPage {
  tasks: RawOfflineTask[]
  pageCount: number
  /** 本月离线配额剩余 / 总数（115 没给时 undefined） */
  quota?: number
  total?: number
}

const STATUS: Record<number, OfflineStatus> = {
  [-1]: 'failed',
  0: 'waiting',
  1: 'running',
  2: 'done',
}

/** 115 的失败响应 → 抛人话 */
function failIfNot(json: Record<string, unknown>): void {
  if (json.state === true || json.state === 1) return
  const errno =
    Number(json.errno ?? json.errcode ?? json.errNo ?? json.code) || 0
  throw new Pan115Error(
    errnoMessage(errno, text(json.error_msg) || text(json.error)),
    errno
  )
}

/** 逐个主机试：404、不是 JSON 时换下一个 */
async function onHosts<T>(run: (host: string) => Promise<T>): Promise<T> {
  let last: unknown
  for (const host of HOSTS) {
    try {
      return await run(host)
    } catch (error) {
      last = error
      const message = error instanceof Pan115Error ? error.message : ''
      if (!/HTTP 404|不是 JSON|连不上/.test(message)) throw error
    }
  }
  throw last
}

/** 解析添加结果（已还原的 JSON） */
export function parseAddResult(
  json: unknown,
  links: readonly string[]
): OfflineAddItem[] {
  const root = obj(json)
  const list = Array.isArray(root.result) ? root.result : [root]
  return links.map((link, i) => {
    const entry = obj(list[i])
    const code = Number(entry.errcode ?? entry.errno) || 0
    const ok = entry.state === true || code === TASK_EXISTS
    return {
      link,
      ok,
      existed: code === TASK_EXISTS,
      hash: text(entry.info_hash),
      name: text(entry.name),
      error: ok
        ? undefined
        : ADD_MESSAGES[code] ||
          text(entry.error_msg) ||
          (code ? `115 返回错误（${code}）` : '115 没有返回结果'),
    }
  })
}

/**
 * 把磁力 / 电驴链接加进云下载，存到文件夹 cid。
 * @param key 测试注入的公钥（默认 115 公钥）
 */
export async function addOfflineUrls(
  fetch: FetchLike,
  userId: string,
  links: readonly string[],
  cid: string,
  key: M115Key = M115_PUBLIC
): Promise<OfflineAddItem[]> {
  if (!links.length) return []
  if (links.length > MAX_OFFLINE_LINKS)
    throw new Pan115Error(`一次最多添加 ${MAX_OFFLINE_LINKS} 个链接`)
  const params: Record<string, string> = {
    ac: 'add_task_urls',
    app_ver: CLIENT_VERSION,
    uid: userId,
    wp_path_id: /^\d+$/.test(cid) ? cid : '0',
  }
  links.forEach((link, i) => (params[`url[${i}]`] = link))
  const { data, seed } = m115Encode(JSON.stringify(params), key)
  const json = await onHosts(async host =>
    obj(
      await fetchJson(
        fetch,
        '115 云下载',
        `${host}/lixianssp/?ac=add_task_urls`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': CLIENT_USER_AGENT,
          },
          body: new URLSearchParams({ data }).toString(),
        }
      )
    )
  )
  failIfNot(json)
  let decoded: unknown = json.data
  if (typeof json.data === 'string') {
    try {
      decoded = JSON.parse(m115Decode(json.data, seed, key))
    } catch {
      throw new Pan115Error('115 云下载返回的内容解不开，可能接口已变')
    }
  }
  return parseAddResult(decoded, links)
}

/** 解析任务列表 */
export function parseTaskList(json: unknown): OfflineTaskPage {
  const root = obj(json)
  failIfNot(root)
  const list = Array.isArray(root.tasks) ? root.tasks : []
  const num = (value: unknown): number | undefined =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value)
  return {
    tasks: list.map((raw): RawOfflineTask => {
      const task = obj(raw)
      const status = STATUS[Number(task.status)] ?? 'waiting'
      const error =
        text(task.err_msg) || text(task.error_msg) || text(task.fail_reason)
      return {
        hash: text(task.info_hash).toLowerCase(),
        name: text(task.name),
        size: Number(task.size) || 0,
        percent: Math.max(0, Math.min(100, Number(task.percentDone) || 0)),
        status,
        addedAt: (Number(task.add_time) || 0) * 1000,
        folderCid: text(task.wp_path_id),
        fileId: text(task.file_id),
        error: status === 'failed' ? error || '115 没给失败原因' : undefined,
      }
    }),
    pageCount: Number(root.page_count) || 1,
    quota: num(root.quota),
    total: num(root.total),
  }
}

/** 读一页任务（新加的在前） */
export async function listOfflineTasks(
  fetch: FetchLike,
  page = 1
): Promise<OfflineTaskPage> {
  return onHosts(async host => {
    const url =
      host === HOSTS[0]
        ? `${host}/web/?ac=task_lists&page=${page}&page_size=${TASK_PAGE_SIZE}`
        : `${host}/lixian/?ct=lixian&ac=task_lists&page=${page}`
    return parseTaskList(await fetchJson(fetch, '115 云下载', url))
  })
}
