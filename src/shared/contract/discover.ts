/**
 * 库外发现：AI 助手 / 在线首页豆瓣卡上「找 115 资源」与「转存」。只有桌面端（115 会话在主进程）。
 *
 * 主进程复用追更的 PanSou 搜索、分享快照与 115 闸门（限速、限额、熔断与追更共用），按电影规则认文件，
 * 返回前 3 个候选；用户点「转存」才只存选中的那个文件到「助手转存目标文件夹」，10 分钟后主动通知媒体库扫描。
 * 候选留在主进程（按 searchId），渲染层转存时只回传 searchId 与序号，不回传分享链接。
 */
import { ContractError, call, defineDomain, int, record, str } from './define'

/** 找资源的对象（第一版只支持电影） */
export interface DiscoverTarget {
  kind: 'movie'
  /** 中文片名 */
  title: string
  /** 原名；不知道时为空串 */
  originalTitle: string
  /** 上映年份；不知道时为 null */
  year: number | null
}

/** 一个候选文件（不含分享链接与提取码） */
export interface DiscoverCandidate {
  fileName: string
  /** 字节数 */
  size: number
  /** 0–100 */
  score: number
  /** 加分理由（给用户看） */
  reasons: string[]
  /** 分享标题（PanSou 的 note） */
  shareTitle: string
}

/** 前提是否满足：115 已登录、PanSou 已填、闸门没暂停 */
export interface DiscoverReady {
  loggedIn: boolean
  pansou: boolean
  /** 闸门暂停的原因；没暂停为 null */
  paused: string | null
  /** 转存目标文件夹的显示名 */
  folder: string
}

/** 缺的前提：去设置 · 网盘 */
export type DiscoverSetup = 'login' | 'pansou'

/** 找资源的结果 */
export type DiscoverFindResult =
  | {
      ok: true
      /** 本次结果的编号，转存时回传 */
      searchId: string
      candidates: DiscoverCandidate[]
      /** 没找到时的简短原因 */
      note: string | null
    }
  | { ok: false; error: string; setup?: DiscoverSetup }

/** 转存的结果 */
export type DiscoverSaveResult =
  | { ok: true; fileName: string; folder: string }
  | { ok: false; error: string; setup?: DiscoverSetup }

const MAX_TITLE = 200

const targetOf = (value: unknown): DiscoverTarget => {
  const raw = record<Record<string, unknown>>(value, 'target')
  if (raw.kind !== 'movie') throw new ContractError('参数 kind 只支持 movie')
  const title = str(raw.title, 'title').trim().slice(0, MAX_TITLE)
  if (!title) throw new ContractError('参数 title 不能为空')
  const year =
    raw.year === null || raw.year === undefined ? null : int(raw.year, 'year')
  if (year !== null && (year < 1900 || year > 2100))
    throw new ContractError('参数 year 超出范围')
  return {
    kind: 'movie',
    title,
    originalTitle: str(raw.originalTitle ?? '', 'originalTitle')
      .trim()
      .slice(0, MAX_TITLE),
    year,
  }
}

/** 库外发现域 */
export const discover = defineDomain('discover', {
  /** 前提是否满足（打开候选面板时先看） */
  status: call<DiscoverReady>(),
  /** 搜 115 资源：返回前 3 个候选 */
  find: call<[target: DiscoverTarget], DiscoverFindResult>(a => [
    targetOf(a[0]),
  ]),
  /** 转存某次结果的第 index 个候选（只存那一个文件） */
  save: call<[searchId: string, index: number], DiscoverSaveResult>(a => [
    str(a[0], 'searchId'),
    int(a[1], 'index'),
  ]),
})
