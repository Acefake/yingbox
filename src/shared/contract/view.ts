import type { BrowseTarget } from '../douban/browse'
import { COLLECTIONS } from '../douban/collections'
import { type DoubanKind, parseDoubanStart } from '../douban/query'
import type { ViewBrowsePage } from '../view/browse'
import type {
  ViewDetail,
  ViewEpisode,
  ViewPlayable,
  ViewResume,
  ViewSources,
} from '../view/detail'
import type { HomeView, ViewCard, ViewContinue } from '../view/home'
import type { ViewSearchCard } from '../view/search'
import type { ViewSourceHealth } from '../view/source-health'
import {
  ContractError,
  bool,
  call,
  defineDomain,
  oneOf,
  optStr,
  record,
  str,
} from './define'

/** 一集的播放源（客户端交回 ViewEpisode）；ext 是插件参数的 JSON 字符串 */
function parseEpisode(value: unknown): ViewEpisode {
  const e = record<Record<string, unknown>>(value, 'episode')
  const ext = optStr(e.ext, 'episode.ext') ?? null
  if (ext !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(ext)
    } catch {
      throw new ContractError('episode.ext 不是合法的 JSON')
    }
    record(parsed, 'episode.ext')
  }
  return {
    name: optStr(e.name, 'episode.name') ?? '',
    url: str(e.url, 'episode.url'),
    siteName: optStr(e.siteName, 'episode.siteName') ?? null,
    ext,
  }
}

const KINDS = ['movie', 'tv'] as const

/** 浏览页目标：热门、某个类型（类型名由查询条件白名单收，不认识的退回全部）、某个精选片单 */
function parseTarget(value: unknown): BrowseTarget {
  const t = record<Record<string, unknown>>(value, 'target')
  const type = oneOf(t.type, 'target.type', ['hot', 'genre', 'list'] as const)
  if (type === 'list')
    return {
      type,
      list: oneOf(
        t.list,
        'target.list',
        COLLECTIONS.map(c => c.id)
      ),
    }
  const kind = oneOf(t.kind, 'target.kind', KINDS)
  return type === 'hot'
    ? { type, kind }
    : { type, kind, genre: str(t.genre, 'target.genre') }
}

/**
 * 视图域（ADR-0030）：服务端用共享规则拼好页面数据，给安卓原生端用。
 * 只在 src/server 实现，不进桌面 IPC 契约表；桌面与网页直接用同一份共享规则。
 * 结果类型在 src/shared/view，Kotlin 由 scripts/gen-view-kotlin.ts 生成。
 */
export const view = defineDomain('view', {
  /** 首页：轮播、继续观看、热门货架、榜单、按类型浏览、精选片单。豆瓣部分缓存；某行取不到就省略这一行。 */
  home: call<HomeView>(),
  /** 「最近播放」整页：全部继续观看（最近的在前） */
  recent: call<ViewContinue[]>(),
  /** 「我的收藏」整页：全部收藏（新收藏在前） */
  favorites: call<ViewCard[]>(),
  /** 搜索：关键词在 CMS 与插件站点里搜，片名相同的合成一张卡（最多等 12 秒，先到的先算）；空关键词返回空 */
  search: call<[keyword: string], ViewSearchCard[]>(a => [
    str(a[0], 'keyword').slice(0, 100),
  ]),
  /** 不再使用的在线站点名（选源、搜索、自动换源都跳过） */
  blockedSites: call<string[]>(),
  /** 屏蔽（on 为真）或恢复一个站点；返回最新的屏蔽列表 */
  blockSite: call<[name: string, on: boolean], string[]>(a => [
    str(a[0], 'name').slice(0, 100),
    bool(a[1], 'on'),
  ]),
  /** 在线源的健康检测进度与结果：全部源跑一遍，通的启用、不通的停用（服务启动时自动跑一次） */
  sourceHealth: call<ViewSourceHealth>(),
  /** 重新检测全部源（已在检测中就复用）；返回当前进度 */
  recheckSources: call<ViewSourceHealth>(),
  /** 浏览页的一页（热门、类型、精选片单）；start 是豆瓣分页位置，第一页为 0 */
  browse: call<[target: BrowseTarget, start: number], ViewBrowsePage>(a => {
    const start = parseDoubanStart(a[1])
    if (start === null) throw new ContractError(`start 不合法：${a[1]}`)
    return [parseTarget(a[0]), start]
  }),
  /** 豆瓣条目详情；取不到为 null */
  detail: call<[subjectId: string, kind: DoubanKind], ViewDetail | null>(a => {
    const id = str(a[0], 'subjectId')
    if (!/^\d{1,12}$/.test(id)) throw new ContractError('豆瓣条目 ID 不合法')
    return [id, oneOf(a[1], 'kind', ['movie', 'tv'] as const)]
  }),
  /** 收藏 / 取消收藏一部豆瓣条目（服务端按豆瓣详情拼出收藏卡），返回之后是否已收藏 */
  favorite: call<[subjectId: string, kind: DoubanKind, on: boolean], boolean>(
    a => {
      const id = str(a[0], 'subjectId')
      if (!/^\d{1,12}$/.test(id)) throw new ContractError('豆瓣条目 ID 不合法')
      return [id, oneOf(a[1], 'kind', KINDS), bool(a[2], 'on')]
    }
  ),
  /** 按片名开始选源（后台搜），返回会话的当前结果；同一部片 10 分钟内复用 */
  sourcesStart: call<[title: string], ViewSources>(a => {
    const title = str(a[0], 'title').trim()
    if (!title) throw new ContractError('title 不能为空')
    return [title]
  }),
  /** 选源会话的当前结果；会话过期为 null（重新 sourcesStart） */
  sources: call<[sessionId: string], ViewSources | null>(a => [
    str(a[0], 'sessionId'),
  ]),
  /** 一条继续观看记录的续播信息；记录不存在或没有可播的剧集为 null */
  resume: call<[continueId: string], ViewResume | null>(a => [
    str(a[0], 'continueId'),
  ]),
  /** 解析一集的播放地址，返回本服务的播放代理路径 */
  resolve: call<[episode: ViewEpisode], ViewPlayable>(a => [
    parseEpisode(a[0]),
  ]),
})
