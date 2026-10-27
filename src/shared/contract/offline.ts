/**
 * 115 离线下载（云下载）：把磁力 / 电驴链接加进 115 云下载，存到调用方选的文件夹（不传 = 电影默认目录）；
 * 主进程（或片库服务）记下经影盒添加的任务，下载完成后通知媒体库入库。桌面端与网页端（片库服务）同一套契约。
 */
import type { TargetFolder } from '../netdisk/target-folder'
import { ContractError, call, defineDomain, event, str } from './define'
import { targetFolderArg } from './pan115'

/** 任务状态 */
export type OfflineStatus = 'waiting' | 'running' | 'done' | 'failed'

/** 添加时一条链接的结果 */
export interface OfflineAddItem {
  link: string
  ok: boolean
  /** 115 里已有这个任务（也算成功） */
  existed: boolean
  /** 115 给的 info_hash；没给时为空串 */
  hash: string
  /** 115 给的任务名；没给时为空串 */
  name: string
  /** 失败原因（人话） */
  error?: string
}

/** 缺的前提：去设置 · 网盘扫码登录 */
export type OfflineSetup = 'login'

/** 添加的结果 */
export type OfflineAddResult =
  | { ok: true; items: OfflineAddItem[]; folder: string }
  | { ok: false; error: string; setup?: OfflineSetup }

/** 一个经影盒添加的离线任务 */
export interface OfflineTask {
  /** 去重键：115 的 info_hash（小写） */
  hash: string
  name: string
  /** 字节数；不知道时 0 */
  size: number
  /** 0–100 */
  percent: number
  status: OfflineStatus
  /** 添加时间（毫秒） */
  addedAt: number
  /** 保存到的 115 文件夹显示名（根目录为空串） */
  folder: string
  /** 已通知媒体库入库 */
  imported: boolean
  /** 失败原因 */
  error?: string
}

/** 任务列表 */
export interface OfflineList {
  loggedIn: boolean
  /** 不另选时新任务会存到的文件夹（电影默认目录）显示名（根目录为空串） */
  folder: string
  /** 新加的在前 */
  tasks: OfflineTask[]
  /** 上次向 115 同步的时间（毫秒）；还没同步过为 null */
  checkedAt: number | null
  /** 这次同步失败的原因（列表照旧给出上次的状态） */
  error?: string
}

/** 一次最多添加几个链接 */
export const MAX_OFFLINE_LINKS = 15
const MAX_LINK = 4096

const linksOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new ContractError('参数 links 应为数组')
  if (!value.length) throw new ContractError('参数 links 不能为空')
  if (value.length > MAX_OFFLINE_LINKS)
    throw new ContractError(`一次最多添加 ${MAX_OFFLINE_LINKS} 个链接`)
  return value.map((link, i) => {
    const text = str(link, `links[${i}]`).trim()
    if (!/^(magnet:\?|ed2k:\/\/)/i.test(text) || text.length > MAX_LINK)
      throw new ContractError(`参数 links[${i}] 应为磁力或电驴链接`)
    return text
  })
}

/** 离线下载域 */
export const offline = defineDomain(
  'offline',
  {
    /** 把磁力 / 电驴链接加进 115 云下载，存到 folder（不传 = 电影默认目录） */
    add: call<
      [links: string[], folder?: TargetFolder | null],
      OfflineAddResult
    >(a => [linksOf(a[0]), targetFolderArg(a[1])]),
    /** 经影盒添加的任务；有没完成的任务时先向 115 同步一次 */
    tasks: call<OfflineList>(),
  },
  {
    /** 任务状态变化（添加、同步、入库后推送） */
    changed: event<void>(),
  }
)
